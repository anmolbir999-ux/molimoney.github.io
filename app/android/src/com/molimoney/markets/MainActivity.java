package com.molimoney.markets;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

/** Shows the bundled offline site (assets/www) full-screen. External links open in the browser. */
public class MainActivity extends Activity {
    private static final String HOME = "file:///android_asset/www/index.html";
    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(false);
        s.setAllowFileAccess(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(true);
        web.setWebViewClient(new LinkClient(this));
        setContentView(web);
        if (state == null || web.restoreState(state) == null) web.loadUrl(HOME);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
