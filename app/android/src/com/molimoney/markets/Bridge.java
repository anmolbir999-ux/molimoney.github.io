package com.molimoney.markets;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
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
