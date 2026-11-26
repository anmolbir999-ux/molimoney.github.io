package com.molimoney.markets;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.util.Calendar;

/** Posts the "market closed – update your paper trades" notification on weekdays. */
public class ReminderReceiver extends BroadcastReceiver {
    private static final String CHANNEL = "daily";

    @Override
    public void onReceive(Context c, Intent intent) {
        int dow = Calendar.getInstance().get(Calendar.DAY_OF_WEEK);
        if (dow == Calendar.SATURDAY || dow == Calendar.SUNDAY) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Daily update", NotificationManager.IMPORTANCE_DEFAULT));
            b = new Notification.Builder(c, CHANNEL);
        } else {
            b = new Notification.Builder(c);
        }
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pi = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        b.setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("Market closed")
                .setContentText("Tap to update your paper trades")
                .setContentIntent(pi)
                .setAutoCancel(true);
        nm.notify(1, b.build());
    }
}
