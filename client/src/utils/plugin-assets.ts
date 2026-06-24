import axios from 'axios'
import { buildApiUrl } from './api-url'

export interface PluginAssetTokenRequest {
  pluginId: string
  assetPath: string
}

export interface PluginAssetTokenResponse {
  assetToken: string
  expiresIn: number
}

export async function requestPluginAssetToken(payload: PluginAssetTokenRequest): Promise<PluginAssetTokenResponse | null> {
  const token = window.localStorage.getItem('token')
  if (!token) return null

  try {
    const response = await axios.post<PluginAssetTokenResponse>(
      buildApiUrl('/plugins/asset-token'),
      payload,
      {
        withCredentials: true,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    )
    return response.data.assetToken ? response.data : null
  } catch {
    return null
  }
}
