import { session } from '../auth/sessionInstance'
import { request } from './http'

export const authApi = {
  /**
   * Change the signed-in user's password. The server then ends every session of this user (and
   * clears the refresh cookie), so we end the local session too and the user signs in again.
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await request<void>('/auth/change-password', {
      method: 'POST',
      json: { current_password: currentPassword, new_password: newPassword },
    })
    session.end('password-changed')
  },
}
