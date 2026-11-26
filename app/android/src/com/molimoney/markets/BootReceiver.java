package com.molimoney.markets;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Re-schedules the daily reminder after the phone restarts. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) && Bridge.prefs(c).getBoolean("reminder", false))
            Reminders.schedule(c);
    }
}
