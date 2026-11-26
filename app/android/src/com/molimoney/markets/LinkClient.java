package com.molimoney.markets;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Keeps bundled pages inside the app; opens web links in the phone's browser. */
public class LinkClient extends WebViewClient {
    private final Activity activity;

    public LinkClient(Activity activity) {
        this.activity = activity;
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, String url) {
        if (url.startsWith("file:///android_asset/")) return false;
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException ignored) {
        }
        return true;
    }
}
