
package com.akshita.wishlink;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SharedProduct")
public class SharedProductPlugin extends Plugin {

    @PluginMethod
    public void getPendingShare(PluginCall call) {
        SharedPreferences prefs = getContext()
                .getSharedPreferences("WishLinkShare", Context.MODE_PRIVATE);

        String sharedText = prefs.getString("pendingText", null);

        prefs.edit().remove("pendingText").apply();

        JSObject result = new JSObject();
        result.put("text", sharedText);

        call.resolve(result);
    }
}
