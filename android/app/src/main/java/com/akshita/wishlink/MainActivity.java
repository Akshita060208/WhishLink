
package com.akshita.wishlink;

import android.content.Intent;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SharedProductPlugin.class);
        super.onCreate(savedInstanceState);
        handleShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleShareIntent(intent);
    }

    private void handleShareIntent(Intent intent) {
        if (intent == null ||
            !Intent.ACTION_SEND.equals(intent.getAction())) {
            return;
        }

        String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);

        if (sharedText != null && !sharedText.trim().isEmpty()) {
            SharedPreferences prefs = getSharedPreferences(
                "WishLinkShare", Context.MODE_PRIVATE
            );

            prefs.edit()
                .putString("pendingText", sharedText.trim())
                .apply();
        }
    }
}
