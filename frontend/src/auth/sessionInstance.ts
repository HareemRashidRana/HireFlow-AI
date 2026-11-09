import { browserDeps, createSessionManager } from './session'

/** The one session for this browser tab. Tests build their own via createSessionManager. */
export const session = createSessionManager(browserDeps())
