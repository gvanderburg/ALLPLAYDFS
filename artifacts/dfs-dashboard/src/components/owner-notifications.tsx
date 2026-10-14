import { useEffect, useState } from "react";
import { Bell, BellOff, LoaderCircle } from "lucide-react";
import {
  getNotificationStatus,
  subscribePushNotifications,
  unsubscribePushNotifications,
} from "@workspace/api-client-react";

type NotificationStatus = Awaited<ReturnType<typeof getNotificationStatus>>;

function decodeApplicationServerKey(key: string) {
  const base64 = key.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = window.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isPushSupported() {
  return window.isSecureContext
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

function isInstalledOnIos() {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export default function OwnerNotifications() {
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [deviceEnabled, setDeviceEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const supported = isPushSupported();

  useEffect(() => {
    let active = true;
    void getNotificationStatus()
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch(() => {
        if (active) setMessage("Phone alerts are unavailable right now. Try again shortly.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    if (supported) {
      void navigator.serviceWorker.ready
        .then((registration) => registration.pushManager.getSubscription())
        .then((subscription) => {
          if (active) setDeviceEnabled(Boolean(subscription));
        })
        .catch(() => undefined);
    }
    return () => { active = false; };
  }, [supported]);

  async function refreshStatus() {
    setStatus(await getNotificationStatus());
  }

  async function enableOnThisDevice() {
    if (!supported || !status?.publicKey) {
      setMessage("Install and open the published ALLPLAY app on a supported device to enable alerts.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage(permission === "denied"
          ? "Notifications are blocked in this browser. Allow them in browser or phone settings, then try again."
          : "Allow notifications to receive owner alerts.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeApplicationServerKey(status.publicKey),
        });
      }
      const value = subscription.toJSON();
      if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) {
        throw new Error("This browser returned an incomplete push subscription.");
      }
      await subscribePushNotifications({
        endpoint: value.endpoint,
        keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
      });
      setDeviceEnabled(true);
      await refreshStatus();
      setMessage("This device is set to receive new signup and membership alerts.");
    } catch {
      setMessage("Could not enable alerts. Make sure ALLPLAY is installed and notifications are allowed, then retry.");
    } finally {
      setBusy(false);
    }
  }

  async function disableOnThisDevice() {
    setBusy(true);
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await unsubscribePushNotifications({ endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setDeviceEnabled(false);
      await refreshStatus();
      setMessage("Phone alerts are off on this device.");
    } catch {
      setMessage("Could not turn off alerts. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const needsIosInstall = typeof window !== "undefined" && isInstalledOnIos();

  return (
    <div className="owner-notifications" role="region" aria-labelledby="owner-notifications-title">
      <div className="account-kicker"><Bell size={14} /> Owner alerts</div>
      <h2 id="owner-notifications-title">Phone notifications</h2>
      <p className="account-panel-intro">
        Get a private alert when a new account signs up or a Whop membership is verified.
        Enable alerts separately on each device you want to notify.
      </p>
      {needsIosInstall && (
        <p className="coverage-detail">On iPhone or iPad, add ALLPLAY to your Home Screen and open the installed app before enabling alerts.</p>
      )}
      {!supported && !needsIosInstall && (
        <p className="coverage-detail">Open the published ALLPLAY app over HTTPS in a browser that supports push notifications.</p>
      )}
      <div className="membership-actions">
        {deviceEnabled
          ? <button className="btn btn-quiet" onClick={() => void disableOnThisDevice()} disabled={busy || loading}><BellOff size={14} /> Turn off on this device</button>
          : <button className="btn btn-primary" onClick={() => void enableOnThisDevice()} disabled={busy || loading || !status?.isOwner || !supported}><Bell size={14} /> Enable on this device</button>}
        {(busy || loading) && <LoaderCircle size={15} className="spin" aria-label="Loading notification settings" />}
        {status?.deviceCount !== undefined && <span className="coverage-detail" style={{ border: 0, padding: 0, margin: 0 }}>{status.deviceCount} device{status.deviceCount === 1 ? "" : "s"} enabled</span>}
      </div>
      <p role="status" aria-live="polite" className="coverage-detail">{message}</p>
    </div>
  );
}
