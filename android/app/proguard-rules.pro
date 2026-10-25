# The page calls these through the JavaScript bridge (MainActivity.Bridge); R8 must keep them.
-keepclassmembers class com.calledit.app.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
