import { sendUserMonitorBeacon } from '@/hooks/web/useMonitor'
import { useAppStoreFingerprint } from '@/store/modules/app/app-fingerprint'
import { useAppStoreGeoIP } from '@/store/modules/app/app-geo-ip'
import { useAppStoreSecurity } from '@/store/modules/app/app-security'
import { setupGoogleAnalytics } from './analytics'

export async function setupAppScripts() {
  await setupGoogleAnalytics()

  const appStoreFingerprint = useAppStoreFingerprint()
  await appStoreFingerprint.setupFingerprint()

  // send beacon with left: false ensure device cache set
  // also to make sure the fingerprint is sent
  sendUserMonitorBeacon({ left: false })

  const appStoreGeoIP = useAppStoreGeoIP()
  await appStoreGeoIP.setupDeviceId()

  const appStoreSecurity = useAppStoreSecurity()
  await appStoreSecurity.setupSign()
}
