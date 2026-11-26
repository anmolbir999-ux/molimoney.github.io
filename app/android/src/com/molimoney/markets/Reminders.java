package com.molimoney.markets;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import java.util.Calendar;

/** Daily inexact alarm at 4:15 PM local time (after NSE closes at 3:30 PM). */
public final class Reminders {
    private Reminders() { }

    private static PendingIntent intent(Context c) {
        Intent i = new Intent(c, ReminderReceiver.class);
        return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static void schedule(Context c) {
        Calendar t = Calendar.getInstance();
        t.set(Calendar.HOUR_OF_DAY, 16);
        t.set(Calendar.MINUTE, 15);
        t.set(Calendar.SECOND, 0);
        if (t.getTimeInMillis() <= System.currentTimeMillis()) t.add(Calendar.DAY_OF_YEAR, 1);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.setInexactRepeating(AlarmManager.RTC_WAKEUP, t.getTimeInMillis(), AlarmManager.INTERVAL_DAY, intent(c));
    }

    public static void cancel(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(intent(c));
    }
}
