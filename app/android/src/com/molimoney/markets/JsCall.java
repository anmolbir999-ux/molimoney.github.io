package com.molimoney.markets;

import android.webkit.WebView;

/** Evaluates a JavaScript snippet in the WebView (must run on the UI thread). */
public class JsCall implements Runnable {
    private final WebView web;
    private final String js;

    public JsCall(WebView web, String js) {
        this.web = web;
        this.js = js;
    }

    @Override
    public void run() {
        web.evaluateJavascript(js, null);
    }
}
