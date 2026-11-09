import { session } from '../auth/sessionInstance'
import { createHttpClient } from './client'

/** The authenticated client the rest of the app uses. */
export const { request } = createHttpClient(session)
