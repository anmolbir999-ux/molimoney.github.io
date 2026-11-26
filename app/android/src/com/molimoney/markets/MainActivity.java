package com.molimoney.markets;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

/** Hosts the paper-trading app (assets/www) and exposes a small native bridge as window.Android. */
public class MainActivity extends Activity {
    private static final String HOME = "file:///android_asset/www/index.html";
    private WebView web;

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

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
