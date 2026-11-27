package com.molimoney.markets;

import android.Manifest;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Methods callable from JavaScript as window.Android.* */
public class Bridge implements Runnable {
    private final Activity activity;
    private final WebView web;

    public Bridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    /** Fetch a URL in the background; result is delivered to window.__resolve(id, ok, body). */
    @JavascriptInterface
    public void get(String id, String url) {
        new Thread(new HttpTask(activity, web, id, url)).start();
    }

    /** Let the user pick a file; its text comes back through window.__resolve(id, ok, text). */
    @JavascriptInterface
    public void pickFile(String id) {
        if (activity instanceof MainActivity) activity.runOnUiThread(new PickFile((MainActivity) activity, id));
    }

    @JavascriptInterface
    public String load() {
        File f = new File(activity.getFilesDir(), "state.json");
        if (!f.exists()) return "";
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    /** Atomic save: write a temp file, then rename over the old state. */
    @JavascriptInterface
    public void save(String json) {
        File dir = activity.getFilesDir(), tmp = new File(dir, "state.tmp"), f = new File(dir, "state.json");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (Exception e) {
            return;
        }
        if (!tmp.renameTo(f)) {
            f.delete();
            tmp.renameTo(f);
        }
    }

    /**
     * Save an exported file where the user can find it: Downloads/Moli on Android 10+,
     * the app's own Download folder on older phones. Returns the location, or "" on failure.
     */
    @JavascriptInterface
    public String download(String name, String mime, String content) {
        byte[] data = content.getBytes(StandardCharsets.UTF_8);
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Moli");
                Uri uri = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) return "";
                try (OutputStream out = activity.getContentResolver().openOutputStream(uri)) {
                    if (out == null) return "";
                    out.write(data);
                }
                return "Downloads/Moli/" + name;
            }
            File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null) return "";
            dir.mkdirs();
            File f = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(data);
            }
            return f.getAbsolutePath();
        } catch (Exception e) {
            return "";
        }
    }

    /** Post an alert notification now (e.g. "Momentum rebalance at tomorrow's open"). */
    @JavascriptInterface
    public void notify(String title, String text) {
        android.app.NotificationManager nm = (android.app.NotificationManager) activity.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        android.app.Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new android.app.NotificationChannel("alerts", "Trade alerts", android.app.NotificationManager.IMPORTANCE_DEFAULT));
            b = new android.app.Notification.Builder(activity, "alerts");
        } else {
            b = new android.app.Notification.Builder(activity);
        }
        android.content.Intent open = new android.content.Intent(activity, MainActivity.class).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        android.app.PendingIntent pi = android.app.PendingIntent.getActivity(activity, 2, open, android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
        b.setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(text)
                .setStyle(new android.app.Notification.BigTextStyle().bigText(text)).setContentIntent(pi).setAutoCancel(true);
        nm.notify(2, b.build());
    }

    @JavascriptInterface
    public boolean canRemind() {
        return true;
    }

    @JavascriptInterface
    public boolean reminderOn() {
        return prefs(activity).getBoolean("reminder", false);
    }

    @JavascriptInterface
    public void setReminder(boolean on) {
        prefs(activity).edit().putBoolean("reminder", on).apply();
        if (on) {
            Reminders.schedule(activity);
            if (Build.VERSION.SDK_INT >= 33) activity.runOnUiThread(this);
        } else {
            Reminders.cancel(activity);
        }
    }

    /** Runs on the UI thread: ask for notification permission (Android 13+). */
    @Override
    public void run() {
        if (Build.VERSION.SDK_INT >= 33)
            activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("paper_trader", Context.MODE_PRIVATE);
    }
}
