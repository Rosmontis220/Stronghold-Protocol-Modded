package com.rosmontis220.wsxy;

import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        hideSystemBars();
        // Keep the project emblem visible while the bundled WebView prepares its first frame.
        android.widget.FrameLayout splash = new android.widget.FrameLayout(this);
        splash.setBackgroundColor(android.graphics.Color.rgb(12, 15, 14));
        android.widget.ImageView emblem = new android.widget.ImageView(this);
        emblem.setImageResource(com.rosmontis220.wsxy.R.drawable.icon_launcher);
        emblem.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        int side = (int) (240 * getResources().getDisplayMetrics().density);
        android.widget.FrameLayout.LayoutParams iconParams = new android.widget.FrameLayout.LayoutParams(side, side, android.view.Gravity.CENTER);
        splash.addView(emblem, iconParams);
        addContentView(splash, new android.view.ViewGroup.LayoutParams(-1, -1));
        splash.postDelayed(() -> {
            if (splash.getParent() instanceof android.view.ViewGroup) {
                ((android.view.ViewGroup) splash.getParent()).removeView(splash);
            }
        }, 1400);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        }
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }
}
