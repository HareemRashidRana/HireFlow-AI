import { useLocation } from 'react-router-dom'

/** Shows where the router ended up, so tests can assert navigation. */
export function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}
