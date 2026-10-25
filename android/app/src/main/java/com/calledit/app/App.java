package com.calledit.app;

import android.app.Application;

import com.onesignal.OneSignal;

// OneSignal must start with the app, before any screen (push is off when no App ID was built in).
public class App extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        if (!BuildConfig.ONESIGNAL_APP_ID.isEmpty()) OneSignal.initWithContext(this, BuildConfig.ONESIGNAL_APP_ID);
    }
}
