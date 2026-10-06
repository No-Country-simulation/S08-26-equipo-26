import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { getUnitDashboard, lookupUnits } from '../api/unitsApi.js'
import { useTranslation } from '../i18n/i18n.js'
import Icon from '../components/Icon.jsx'

function formatDate(value) {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function statusClass(status) {
  if (!status) return 'status-muted'

  const normalized = status.toLowerCase()

  if (
    ['approved', 'completed', 'resolved', 'collected', 'closed'].includes(
      normalized,
    )
  ) {
    return 'status-success'
  }

  if (
    [
      'pending',
      'received',
      'notified',
      'scheduled',
      'in_progress',
      'open',
    ].includes(normalized)
  ) {
    return 'status-pending'
  }

  if (
    ['rejected', 'cancelled', 'cancelled_by_resident'].includes(normalized)
  ) {
    return 'status-error'
  }

  return 'status-info'
}

function Section({ title, count, children }) {
  return (
    <section className="unit-workspace-section">
      <div className="unit-workspace-section-header">
        <h3>{title}</h3>
        <span className="status-pill">{count}</span>
      </div>

      {children}
    </section>
  )
}

function EmptySection() {
  return <p className="muted unit-workspace-empty">No records found.</p>
}

function UnitLookupPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selectedUnit, setSelectedUnit] = useState(null)
  const [dashboard, setDashboard] = useState(null)
  const [loadingResults, setLoadingResults] = useState(false)
  const [loadingDashboard, setLoadingDashboard] = useState(false)
  const [error, setError] = useState('')

  const searchInputRef = useRef(null)
  const lastSearchedQueryRef = useRef('')

  /*
   * Restore the search text when returning from another module.
   */
  useEffect(() => {
    const restoredQuery = searchParams.get('query')

    if (restoredQuery && restoredQuery !== query) {
      setQuery(restoredQuery)
    }
  }, [searchParams, query])

  /*
   * Search units.
   *
   * One character is enough for a valid lookup. This is important for
   * buildings where units are numbered sequentially, for example 1–50.
   */
  const searchUnits = async (value) => {
    const normalized = value.trim()

    if (!normalized) {
      setResults([])
      setError('')
      lastSearchedQueryRef.current = ''
      return
    }

    setLoadingResults(true)
    setError('')

    try {
      const response = await lookupUnits(normalized)

      setResults(Array.isArray(response) ? response : [])
      lastSearchedQueryRef.current = normalized
    } catch (requestError) {
      setError(requestError.message || t('Unable to search units.'))
      setResults([])
      lastSearchedQueryRef.current = normalized
    } finally {
      setLoadingResults(false)
    }
  }

  /*
   * Search automatically after the user stops typing.
   */
  useEffect(() => {
    const normalized = query.trim()

    if (!normalized) {
      setResults([])
      setError('')
      lastSearchedQueryRef.current = ''
      return undefined
    }

    /*
     * Avoid repeating the same request when the explicit search button
     * has already searched this exact value.
     */
    if (normalized === lastSearchedQueryRef.current) {
      return undefined
    }

    let cancelled = false

    const timer = window.setTimeout(async () => {
      setLoadingResults(true)
      setError('')

      try {
        const response = await lookupUnits(normalized)

        if (!cancelled) {
          setResults(Array.isArray(response) ? response : [])
          lastSearchedQueryRef.current = normalized
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.message || t('Unable to search units.'))
          setResults([])
          lastSearchedQueryRef.current = normalized
        }
      } finally {
        if (!cancelled) {
          setLoadingResults(false)
        }
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, t])

  const handleSearch = async (event) => {
    event.preventDefault()

    const normalized = query.trim()

    if (!normalized) {
      searchInputRef.current?.focus()
      return
    }

    await searchUnits(normalized)
  }

  const openUnit = async (unit) => {
    const nextParams = new URLSearchParams({
      query: query.trim(),
      unitId: unit.id,
    })

    setSearchParams(nextParams, { replace: true })

    setSelectedUnit(unit)
    setDashboard(null)
    setLoadingDashboard(true)
    setError('')

    try {
      const response = await getUnitDashboard(unit.id)
      setDashboard(response)
    } catch (requestError) {
      setError(
        requestError.message || t('Unable to load the unit workspace.'),
      )
    } finally {
      setLoadingDashboard(false)
    }
  }

  /*
   * Restore the selected apartment/workspace when returning from
   * another module.
   *
   * The URL contains:
   *   query=...
   *   unitId=...
   *
   * Once the search results are available, find that unit and reopen
   * the normal Unit Lookup workspace.
   */
  useEffect(() => {
    const unitId = searchParams.get('unitId')

    if (!unitId || !results.length || selectedUnit) {
      return
    }

    const matchingUnit = results.find((unit) => unit.id === unitId)

    if (!matchingUnit) {
      return
    }

    openUnit(matchingUnit)

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('unitId')
    setSearchParams(nextParams, { replace: true })
  }, [results, searchParams, selectedUnit, setSearchParams])

  /*
   * M24.10
   *
   * Unit Lookup does not duplicate the detail modals from the mother pages.
   * Instead, it navigates to the owning module and passes the record ID
   * through the URL.
   *
   * The Unit Lookup context is also passed explicitly:
   *
   *   returnTo=unit-lookup
   *   lookupQuery=...
   *   lookupUnitId=...
   *
   * This allows the mother page to return directly to this exact
   * Unit Lookup workspace without relying on browser history.
   */
  const openLinkedRecord = (type, id) => {
    if (!id || !selectedUnit) return

    const routes = {
      resident: '/dashboard/residents',
      delivery: '/dashboard/deliveries',
      move: '/dashboard/moves',
      incident: '/dashboard/incidents',
      maintenance: '/dashboard/maintenance',
    }

    const route = routes[type]

    if (!route) return

    const params = new URLSearchParams({
      openId: id,
      returnTo: 'unit-lookup',
      lookupQuery: query.trim(),
      lookupUnitId: selectedUnit.id,
    })

    navigate(`${route}?${params.toString()}`)
  }

  const resetLookup = () => {
    setSelectedUnit(null)
    setDashboard(null)
    setQuery('')
    setResults([])
    setError('')
    lastSearchedQueryRef.current = ''

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('query')
    nextParams.delete('unitId')

    setSearchParams(nextParams, { replace: true })

    window.setTimeout(() => {
      searchInputRef.current?.focus()
    }, 0)
  }

  const current =
    dashboard ||
    (selectedUnit
      ? {
          unit: {
            id: selectedUnit.id,
            buildingId: selectedUnit.buildingId,
            buildingName: selectedUnit.buildingName,
            unitNumber: selectedUnit.unitNumber,
            floorNumber: selectedUnit.floorNumber,
            unitType: selectedUnit.unitType,
          },
          residents: [],
          accessHistory: [],
          pendingDeliveries: [],
          bookings: [],
          activeMoveRequests: [],
          incidents: [],
          maintenanceRequests: [],
        }
      : null)

  return (
    <section className="module-page">
      <div className="module-page-header">
        <div>
          <p className="eyebrow">{t('UNIT LOOKUP')}</p>

          <h2>{t('Unified Unit Lookup')}</h2>

          <p className="muted">
            {t(
              'Search a unit and view its connected operational records in one workspace.',
            )}
          </p>
        </div>
      </div>

      <section className="data-panel">
        <form
          onSubmit={handleSearch}
          className="unit-lookup-search-row"
        >
          <label className="unit-lookup-search">
            <span>
              {t('Search by unit, building name or building code')}
            </span>

            <div className="unit-lookup-input-wrap">
              <button
                className="unit-lookup-search-button"
                type="submit"
                aria-label={t('Search units')}
                title={t('Search')}
              >
                <Icon name="search" size={18} />
              </button>

              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('e.g. 4B, Tower A, TWR-A')}
                aria-label={t('Unit lookup search')}
              />
            </div>
          </label>

          <div className="unit-lookup-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={resetLookup}
            >
              {t('New search')}
            </button>
          </div>
        </form>

        {query.trim().length === 0 && (
          <p className="muted lookup-hint">
            {t('Enter a unit number, building name or building code.')}
          </p>
        )}

        {loadingResults && (
          <div className="lookup-results-message">
            {t('Searching...')}
          </div>
        )}

        {!loadingResults &&
          query.trim().length >= 1 &&
          !selectedUnit &&
          (results.length > 0 ? (
            <div className="lookup-results">
              {results.map((unit) => (
                <button
                  className="lookup-result"
                  type="button"
                  key={unit.id}
                  onClick={() => openUnit(unit)}
                >
                  <span className="lookup-result-icon">
                    <Icon name="home" size={18} />
                  </span>

                  <span className="lookup-result-main">
                    <strong>{unit.unitNumber}</strong>

                    <small>
                      {unit.buildingName} ({unit.buildingCode})
                    </small>
                  </span>

                  <span className="lookup-result-meta">
                    {unit.floorNumber == null
                      ? '—'
                      : `${t('Floor')} ${unit.floorNumber}`}
                  </span>

                  <Icon name="chevronRight" size={16} />
                </button>
              ))}
            </div>
          ) : (
            <div className="lookup-results-message">
              {t('No matching units found.')}
            </div>
          ))}

        {error && (
          <div className="feedback feedback-error" role="alert">
            {error}
          </div>
        )}
      </section>

      {loadingDashboard && (
        <section className="data-panel">
          <div className="modal-loading-state">
            {t('Loading unit workspace...')}
          </div>
        </section>
      )}

      {current && !loadingDashboard && (
        <section className="unit-workspace">
          <div className="unit-workspace-header">
            <div>
              <p className="eyebrow">{t('UNIT')}</p>

              <h3>{current.unit.unitNumber}</h3>

              <p className="muted">
                {current.unit.buildingName ||
                  selectedUnit?.buildingName ||
                  t('Building')}
              </p>
            </div>

            <div className="unit-workspace-meta">
              <span>
                {t('Floor')}:{' '}
                <strong>{current.unit.floorNumber ?? '—'}</strong>
              </span>

              <span>
                {t('Type')}:{' '}
                <strong>{current.unit.unitType || '—'}</strong>
              </span>
            </div>
          </div>

          <div className="unit-workspace-kpis">
            <div className="metric-card">
              <span className="metric-card-label">
                {t('Residents')}
              </span>

              <strong className="metric-card-value">
                {current.residents.length}
              </strong>
            </div>

            <div className="metric-card">
              <span className="metric-card-label">
                {t('Pending deliveries')}
              </span>

              <strong className="metric-card-value">
                {current.pendingDeliveries.length}
              </strong>
            </div>

            <div className="metric-card">
              <span className="metric-card-label">
                {t('Open incidents')}
              </span>

              <strong className="metric-card-value">
                {current.incidents.length}
              </strong>
            </div>

            <div className="metric-card">
              <span className="metric-card-label">
                {t('Maintenance requests')}
              </span>

              <strong className="metric-card-value">
                {current.maintenanceRequests.length}
              </strong>
            </div>
          </div>

          <div className="unit-workspace-grid">
            <Section
              title={t('Residents')}
              count={current.residents.length}
            >
              {current.residents.length === 0 ? (
                <EmptySection />
              ) : (
                <div className="workspace-list">
                  {current.residents.map((resident) => (
                    <button
                      className="workspace-list-row workspace-list-row-clickable"
                      type="button"
                      key={resident.id}
                      onClick={() =>
                        openLinkedRecord('resident', resident.id)
                      }
                    >
                      <div>
                        <strong>
                          {resident.firstName} {resident.lastName}
                        </strong>

                        <span>
                          {resident.residentType}
                          {resident.primaryContact
                            ? ` · ${t('Primary contact')}`
                            : ''}
                        </span>
                      </div>

                      <Icon name="chevronRight" size={16} />
                    </button>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title={t('Pending deliveries')}
              count={current.pendingDeliveries.length}
            >
              {current.pendingDeliveries.length === 0 ? (
                <EmptySection />
              ) : (
                <div className="workspace-list">
                  {current.pendingDeliveries.map((item) => (
                    <button
                      className="workspace-list-row workspace-list-row-clickable"
                      type="button"
                      key={item.id}
                      onClick={() =>
                        openLinkedRecord('delivery', item.id)
                      }
                    >
                      <div>
                        <strong>{item.deliveryType}</strong>

                        <span>
                          {item.carrierName ||
                            t('Unknown carrier')}{' '}
                          · {formatDate(item.receivedAt)}
                        </span>
                      </div>

                      <span className="workspace-list-row-end">
                        <span
                          className={`status-badge ${statusClass(
                            item.status,
                          )}`}
                        >
                          {item.status}
                        </span>

                        <Icon name="chevronRight" size={16} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title={t('Recent access')}
              count={current.accessHistory.length}
            >
              {current.accessHistory.length === 0 ? (
                <EmptySection />
              ) : (
                <div className="workspace-list">
                  {current.accessHistory.slice(0, 8).map((item) => (
                    <div
                      className="workspace-list-row"
                      key={item.id}
                    >
                      <div>
                        <strong>
                          {item.direction} · {item.accessMethod}
                        </strong>

                        <span>{formatDate(item.occurredAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title={t('Bookings')}
              count={current.bookings.length}
            >
              {current.bookings.length === 0 ? (
                <EmptySection />
              ) : (
                <div className="workspace-list">
                  {current.bookings.slice(0, 8).map((item) => (
                    <div
                      className="workspace-list-row"
                      key={item.id}
                    >
                      <div>
                        <strong>
                          {item.commonAreaName ||
                            item.commonAreaId}
                        </strong>

                        <span>
                          {formatDate(item.startAt)} —{' '}
                          {formatDate(item.endAt)}
                        </span>
                      </div>

                      <span
                        className={`status-badge ${statusClass(
                          item.status,
                        )}`}
                      >
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title={t('Move requests')}
              count={current.activeMoveRequests.length}
            >
              {current.activeMoveRequests.length === 0 ? (
                <EmptySection />
              ) : (
                <div className="workspace-list">
                  {current.activeMoveRequests.map((item) => (
                    <button
                      className="workspace-list-row workspace-list-row-clickable"
                      type="button"
                      key={item.id}
                      onClick={() =>
                        openLinkedRecord('move', item.id)
                      }
                    >
                      <div>
                        <strong>{item.requestType}</strong>

                        <span>
                          {item.scheduledStart
                            ? formatDate(item.scheduledStart)
                            : formatDate(item.requestedAt)}
                        </span>
                      </div>

                      <span className="workspace-list-row-end">
                        <span
                          className={`status-badge ${statusClass(
                            item.status,
                          )}`}
                        >
                          {item.status}
                        </span>

                        <Icon name="chevronRight" size={16} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title={t('Incidents')}
              count={current.incidents.length}
            >
              {current.incidents.length === 0 ? (
                <EmptySection />
              ) : (
                <div className="workspace-list">
                  {current.incidents.slice(0, 8).map((item) => (
                    <button
                      className="workspace-list-row workspace-list-row-clickable"
                      type="button"
                      key={item.id}
                      onClick={() =>
                        openLinkedRecord('incident', item.id)
                      }
                    >
                      <div>
                        <strong>{item.title}</strong>

                        <span>
                          {item.severity} ·{' '}
                          {formatDate(item.occurredAt)}
                        </span>
                      </div>

                      <span className="workspace-list-row-end">
                        <span
                          className={`status-badge ${statusClass(
                            item.status,
                          )}`}
                        >
                          {item.status}
                        </span>

                        <Icon name="chevronRight" size={16} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title={t('Maintenance')}
              count={current.maintenanceRequests.length}
            >
              {current.maintenanceRequests.length === 0 ? (
                <EmptySection />
              ) : (
                <div className="workspace-list">
                  {current.maintenanceRequests
                    .slice(0, 8)
                    .map((item) => (
                      <button
                        className="workspace-list-row workspace-list-row-clickable"
                        type="button"
                        key={item.id}
                        onClick={() =>
                          openLinkedRecord(
                            'maintenance',
                            item.id,
                          )
                        }
                      >
                        <div>
                          <strong>
                            {item.category ||
                              t('Maintenance request')}
                          </strong>

                          <span>
                            {item.priority} ·{' '}
                            {formatDate(
                              item.scheduledAt ||
                                item.createdAt,
                            )}
                          </span>
                        </div>

                        <span className="workspace-list-row-end">
                          <span
                            className={`status-badge ${statusClass(
                              item.status,
                            )}`}
                          >
                            {item.status}
                          </span>

                          <Icon
                            name="chevronRight"
                            size={16}
                          />
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </Section>
          </div>
        </section>
      )}
    </section>
  )
}

export default UnitLookupPage