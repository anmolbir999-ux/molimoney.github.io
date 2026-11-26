package com.molimoney.markets;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Hosts the paper-trading app (assets/www) and exposes a small native bridge as window.Android. */
public class MainActivity extends Activity {
    private static final String HOME = "file:///android_asset/www/index.html";
    static final int PICK_FILE = 42;
    private static final int MAX_FILE = 25 * 1024 * 1024;
    private WebView web;
    String pickId;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        web.setWebViewClient(new LinkClient(this));
        web.addJavascriptInterface(new Bridge(this, web), "Android");
        setContentView(web);
        web.loadUrl(HOME);
    }

    /** Hand a result back to JavaScript (window.__resolve). */
    void resolve(String id, boolean ok, String body) {
        String js = "window.__resolve(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(body) + ")";
        runOnUiThread(new JsCall(web, js));
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_FILE || pickId == null) return;
        String id = pickId;
        pickId = null;
        Uri uri = data == null ? null : data.getData();
        if (result != RESULT_OK || uri == null) { resolve(id, false, "cancelled"); return; }
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) { resolve(id, false, "Could not open the file"); return; }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n, total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_FILE) { resolve(id, false, "File is too big"); return; }
                out.write(buf, 0, n);
            }
            resolve(id, true, new String(out.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            resolve(id, false, "Could not read the file");
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
