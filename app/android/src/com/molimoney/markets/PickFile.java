package com.molimoney.markets;

import android.content.Intent;

/** Opens the system file picker (runs on the UI thread). */
public class PickFile implements Runnable {
    private final MainActivity activity;
    private final String id;

    public PickFile(MainActivity activity, String id) {
        this.activity = activity;
        this.id = id;
    }

    @Override
    public void run() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
        activity.pickId = id;
        try {
            activity.startActivityForResult(i, MainActivity.PICK_FILE);
        } catch (Exception e) {
            activity.resolve(id, false, "No file picker available");
        }
    }
}
