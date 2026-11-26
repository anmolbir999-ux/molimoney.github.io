package com.molimoney.markets;

import android.app.Activity;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Background HTTP GET whose result is handed back to JavaScript. */
public class HttpTask implements Runnable {
    private final Activity activity;
    private final WebView web;
    private final String id, url;

    public HttpTask(Activity activity, WebView web, String id, String url) {
        this.activity = activity;
        this.web = web;
        this.id = id;
        this.url = url;
    }

    @Override
    public void run() {
        boolean ok = false;
        String body;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) PaperTrader/2.0");
            c.setRequestProperty("Accept", "application/json");
            int code = c.getResponseCode();
            InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (in != null) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                in.close();
            }
            body = new String(out.toByteArray(), StandardCharsets.UTF_8);
            ok = code < 400;
            if (!ok) body = "HTTP " + code;
        } catch (Exception e) {
            body = e.getClass().getSimpleName() + ": " + e.getMessage();
        } finally {
            if (c != null) c.disconnect();
        }
        String js = "window.__resolve(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(body) + ")";
        activity.runOnUiThread(new JsCall(web, js));
    }
}
