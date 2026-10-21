package com.opencode.mobile;

import android.app.Application;

public class OpenCodeApplication extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        LocalServerService.createChannel(this);
    }
}
