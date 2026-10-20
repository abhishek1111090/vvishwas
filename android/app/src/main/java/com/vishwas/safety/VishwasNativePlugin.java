package com.vishwas.safety;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.telephony.SmsManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * VishwasNative — app-local Capacitor plugin (JS side: src/platform/vishwasNative.js).
 *
 *  • camera / microphone / SMS runtime permission status and requests
 *  • openAppSettings() for permanently denied permissions
 *  • sendSms(): sends the emergency text with SmsManager and reports the
 *    REAL per-recipient result from the carrier's sent-intent. Delivery
 *    reports (if the carrier provides them) arrive later as "smsStatus"
 *    events. Nothing is reported as sent unless Android says RESULT_OK.
 */
@CapacitorPlugin(
    name = "VishwasNative",
    permissions = {
        @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }),
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS })
    }
)
public class VishwasNativePlugin extends Plugin {

    private static final String ACTION_SENT = "com.vishwas.safety.SMS_SENT";
    private static final String ACTION_DELIVERED = "com.vishwas.safety.SMS_DELIVERED";
    private static final long SEND_TIMEOUT_MS = 60_000;

    private final AtomicInteger requestCodes = new AtomicInteger(1000);
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private BroadcastReceiver deliveryReceiver;

    /** Delivered-part counters keyed by "requestId|phone". */
    private final Map<String, int[]> deliveryProgress = new HashMap<>();

    @Override
    public void load() {
        deliveryReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String requestId = intent.getStringExtra("requestId");
                String phone = intent.getStringExtra("phoneNumber");
                int parts = intent.getIntExtra("parts", 1);
                String key = requestId + "|" + phone;
                boolean ok = getResultCode() == Activity.RESULT_OK;

                JSObject event = new JSObject();
                event.put("requestId", requestId);
                event.put("phoneNumber", phone);
                if (!ok) {
                    deliveryProgress.remove(key);
                    event.put("status", "deliveryFailed");
                    event.put("error", "Carrier reported delivery failure");
                    notifyListeners("smsStatus", event);
                    return;
                }
                int[] count = deliveryProgress.get(key);
                if (count == null) {
                    count = new int[] { 0 };
                    deliveryProgress.put(key, count);
                }
                count[0]++;
                if (count[0] >= parts) {
                    deliveryProgress.remove(key);
                    event.put("status", "delivered");
                    notifyListeners("smsStatus", event);
                }
            }
        };
        ContextCompat.registerReceiver(
            getContext(), deliveryReceiver, new IntentFilter(ACTION_DELIVERED), ContextCompat.RECEIVER_NOT_EXPORTED
        );
    }

    @Override
    protected void handleOnDestroy() {
        if (deliveryReceiver != null) {
            try {
                getContext().unregisterReceiver(deliveryReceiver);
            } catch (IllegalArgumentException ignored) {
                // Receiver already unregistered.
            }
            deliveryReceiver = null;
        }
    }

    // ─── Permissions ────────────────────────────────────────────────────────

    private boolean hasCamera() {
        return getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY);
    }

    private boolean hasMicrophone() {
        return getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_MICROPHONE);
    }

    private boolean canSendSms() {
        return getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELEPHONY_MESSAGING);
    }

    private JSObject mediaStates() {
        JSObject result = new JSObject();
        result.put("camera", hasCamera() ? getPermissionState("camera").toString() : "unavailable");
        result.put("microphone", hasMicrophone() ? getPermissionState("microphone").toString() : "unavailable");
        return result;
    }

    @PluginMethod
    public void checkMediaPermissions(PluginCall call) {
        call.resolve(mediaStates());
    }

    @PluginMethod
    public void requestMediaPermissions(PluginCall call) {
        List<String> aliases = new ArrayList<>();
        JSArray requested = call.getArray("permissions");
        try {
            if (requested != null) {
                for (Object alias : requested.toList()) {
                    if ("camera".equals(alias) && hasCamera()) aliases.add("camera");
                    if ("microphone".equals(alias) && hasMicrophone()) aliases.add("microphone");
                }
            }
        } catch (JSONException e) {
            call.reject("Invalid permissions list", "INVALID_ARGUMENT");
            return;
        }
        if (aliases.isEmpty()) {
            call.resolve(mediaStates());
            return;
        }
        requestPermissionForAliases(aliases.toArray(new String[0]), call, "mediaPermissionsCallback");
    }

    @PermissionCallback
    private void mediaPermissionsCallback(PluginCall call) {
        call.resolve(mediaStates());
    }

    private JSObject smsState() {
        JSObject result = new JSObject();
        result.put("sms", canSendSms() ? getPermissionState("sms").toString() : "unavailable");
        return result;
    }

    @PluginMethod
    public void checkSmsPermission(PluginCall call) {
        call.resolve(smsState());
    }

    @PluginMethod
    public void requestSmsPermission(PluginCall call) {
        if (!canSendSms()) {
            call.resolve(smsState());
            return;
        }
        requestPermissionForAlias("sms", call, "smsPermissionCallback");
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        call.resolve(smsState());
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open app settings", "SETTINGS_UNAVAILABLE", e);
        }
    }

    // ─── SMS ────────────────────────────────────────────────────────────────

    private SmsManager smsManager() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return getContext().getSystemService(SmsManager.class);
        }
        return SmsManager.getDefault();
    }

    private static String describeSentError(int code) {
        switch (code) {
            case SmsManager.RESULT_ERROR_NO_SERVICE: return "No mobile service";
            case SmsManager.RESULT_ERROR_RADIO_OFF: return "Mobile radio off (airplane mode?)";
            case SmsManager.RESULT_ERROR_NULL_PDU: return "Message could not be encoded";
            case SmsManager.RESULT_ERROR_GENERIC_FAILURE: return "Carrier rejected the message";
            default: return "SMS failed (code " + code + ")";
        }
    }

    @PluginMethod
    public void sendSms(PluginCall call) {
        if (!canSendSms()) {
            call.reject("This device cannot send SMS", "UNAVAILABLE");
            return;
        }
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("SMS permission not granted", "PERMISSION_DENIED");
            return;
        }

        final String requestId = call.getString("requestId", "");
        final String message = call.getString("message", "");
        JSArray recipientsArray = call.getArray("recipients");
        final List<String> recipients = new ArrayList<>();
        try {
            if (recipientsArray != null) {
                for (Object r : recipientsArray.toList()) {
                    if (r instanceof String && !((String) r).trim().isEmpty()) recipients.add(((String) r).trim());
                }
            }
        } catch (JSONException e) {
            call.reject("Invalid recipients", "INVALID_ARGUMENT");
            return;
        }
        if (recipients.isEmpty() || message.isEmpty()) {
            call.reject("No recipients or empty message", "INVALID_ARGUMENT");
            return;
        }

        final SmsManager sms = smsManager();
        if (sms == null) {
            call.reject("SMS service unavailable", "UNAVAILABLE");
            return;
        }
        final ArrayList<String> parts = sms.divideMessage(message);
        final int partCount = parts.size();

        // Per-recipient outcome; resolved once every recipient has a result or on timeout.
        final Map<String, JSObject> results = new HashMap<>();
        final Map<String, int[]> sentParts = new HashMap<>();
        final String sentAction = ACTION_SENT + "." + requestCodes.incrementAndGet();
        final boolean[] finished = { false };

        final BroadcastReceiver sentReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String phone = intent.getStringExtra("phoneNumber");
                if (phone == null || results.containsKey(phone)) return;
                int code = getResultCode();
                if (code != Activity.RESULT_OK) {
                    JSObject r = new JSObject();
                    r.put("phoneNumber", phone);
                    r.put("status", "failed");
                    r.put("error", describeSentError(code));
                    results.put(phone, r);
                } else {
                    int[] done = sentParts.get(phone);
                    if (done == null) {
                        done = new int[] { 0 };
                        sentParts.put(phone, done);
                    }
                    done[0]++;
                    if (done[0] >= partCount) {
                        JSObject r = new JSObject();
                        r.put("phoneNumber", phone);
                        r.put("status", "sent");
                        results.put(phone, r);
                    }
                }
                if (results.size() >= recipients.size()) finish(call, this, results, recipients, finished);
            }
        };
        ContextCompat.registerReceiver(
            getContext(), sentReceiver, new IntentFilter(sentAction), ContextCompat.RECEIVER_NOT_EXPORTED
        );

        for (String phone : recipients) {
            ArrayList<PendingIntent> sentIntents = new ArrayList<>();
            ArrayList<PendingIntent> deliveryIntents = new ArrayList<>();
            for (int i = 0; i < partCount; i++) {
                Intent sent = new Intent(sentAction).setPackage(getContext().getPackageName());
                sent.putExtra("phoneNumber", phone);
                sentIntents.add(PendingIntent.getBroadcast(
                    getContext(), requestCodes.incrementAndGet(), sent, PendingIntent.FLAG_IMMUTABLE));

                Intent delivered = new Intent(ACTION_DELIVERED).setPackage(getContext().getPackageName());
                delivered.putExtra("requestId", requestId);
                delivered.putExtra("phoneNumber", phone);
                delivered.putExtra("parts", partCount);
                deliveryIntents.add(PendingIntent.getBroadcast(
                    getContext(), requestCodes.incrementAndGet(), delivered, PendingIntent.FLAG_IMMUTABLE));
            }
            try {
                if (partCount > 1) {
                    sms.sendMultipartTextMessage(phone, null, parts, sentIntents, deliveryIntents);
                } else {
                    sms.sendTextMessage(phone, null, message, sentIntents.get(0), deliveryIntents.get(0));
                }
            } catch (Exception e) {
                JSObject r = new JSObject();
                r.put("phoneNumber", phone);
                r.put("status", "failed");
                r.put("error", e.getMessage() != null ? e.getMessage() : "Could not hand SMS to the system");
                results.put(phone, r);
            }
        }

        if (results.size() >= recipients.size()) {
            finish(call, sentReceiver, results, recipients, finished);
            return;
        }

        mainHandler.postDelayed(() -> {
            for (String phone : recipients) {
                if (!results.containsKey(phone)) {
                    JSObject r = new JSObject();
                    r.put("phoneNumber", phone);
                    r.put("status", "failed");
                    r.put("error", "No response from the carrier within 60s");
                    results.put(phone, r);
                }
            }
            finish(call, sentReceiver, results, recipients, finished);
        }, SEND_TIMEOUT_MS);
    }

    private void finish(PluginCall call, BroadcastReceiver receiver, Map<String, JSObject> results,
                        List<String> recipients, boolean[] finished) {
        if (finished[0]) return;
        finished[0] = true;
        try {
            getContext().unregisterReceiver(receiver);
        } catch (IllegalArgumentException ignored) {
            // Already unregistered.
        }
        JSArray out = new JSArray();
        for (String phone : recipients) {
            JSObject r = results.get(phone);
            if (r != null) out.put(r);
        }
        JSObject ret = new JSObject();
        ret.put("results", out);
        call.resolve(ret);
    }
}
