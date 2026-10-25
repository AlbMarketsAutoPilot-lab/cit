package com.calledit.app;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import androidx.webkit.WebViewAssetLoader;

import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdSize;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.MobileAds;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;
import com.onesignal.Continue;
import com.onesignal.OneSignal;

import java.util.concurrent.atomic.AtomicBoolean;

// One screen: the app (assets/index.html, built from web/) in a WebView, with an AdMob banner on top.
// Files are served from the APK on a fixed https address, so the page and its saved sign-in stay in one place.
public class MainActivity extends ComponentActivity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/index.html";
    private static final int BACKGROUND = Color.rgb(0x0b, 0x14, 0x10);

    private WebViewAssetLoader loader;
    private LinearLayout root;
    private FrameLayout adBox;
    private WebView webView;
    private AdView adView;
    private ConsentInformation consent;
    private final AtomicBoolean adsStarted = new AtomicBoolean(false);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BACKGROUND);
        adBox = new FrameLayout(this);
        root.addView(adBox, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) fitSystemBars();
        setContentView(root);
        showApp(savedInstanceState);
        setupAds();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView == null) {
                    finish();
                    return;
                }
                webView.evaluateJavascript("window.citBack && window.citBack() ? 1 : 0", result -> {
                    if (!"1".equals(result)) finish();
                });
            }
        });
    }

    // Android 11+: draw edge to edge (forced from Android 15) and keep content clear of the bars and keyboard.
    @RequiresApi(Build.VERSION_CODES.R)
    private void fitSystemBars() {
        getWindow().setDecorFitsSystemWindows(false);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void showApp(Bundle savedInstanceState) {
        webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        webView.setWebViewClient(new AppClient());
        webView.addJavascriptInterface(new Bridge(), "CalledIt");
        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(START_URL);
        }
    }

    private class AppClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(@NonNull WebView view, @NonNull WebResourceRequest request) {
            return loader.shouldInterceptRequest(request.getUrl());
        }

        // The app page stays inside; any other link (privacy policies, Play) opens in the browser.
        @Override
        public boolean shouldOverrideUrlLoading(@NonNull WebView view, @NonNull WebResourceRequest request) {
            if (HOST.equals(request.getUrl().getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
            } catch (ActivityNotFoundException ignored) {
            }
            return true;
        }

        @Override
        public boolean onRenderProcessGone(@NonNull WebView view, @NonNull RenderProcessGoneDetail detail) {
            if (view == webView) {
                removeWebView();
                showApp(null);
            }
            return true;
        }
    }

    // Called by the page (web/src/main.ts, interface Bridge).
    private class Bridge {
        @JavascriptInterface
        public void share(String text) {
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(send, getString(R.string.invite)));
            });
        }

        @JavascriptInterface
        public void login(String id) {
            if (pushOn()) OneSignal.login(id);
        }

        @JavascriptInterface
        public void logout() {
            if (pushOn()) OneSignal.logout();
        }

        @JavascriptInterface
        public void push() {
            if (pushOn()) runOnUiThread(() -> OneSignal.getNotifications().requestPermission(true, Continue.none()));
        }

        @JavascriptInterface
        public boolean hasPrivacy() {
            return consent != null && consent.getPrivacyOptionsRequirementStatus()
                    == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
        }

        @JavascriptInterface
        public void privacy() {
            runOnUiThread(() -> UserMessagingPlatform.showPrivacyOptionsForm(MainActivity.this, error -> {
            }));
        }
    }

    private static boolean pushOn() {
        return !BuildConfig.ONESIGNAL_APP_ID.isEmpty();
    }

    // Consent first (Google UMP: EEA/UK), then ads. A consent given earlier allows ads straight away.
    private void setupAds() {
        consent = UserMessagingPlatform.getConsentInformation(this);
        consent.requestConsentInfoUpdate(this, new ConsentRequestParameters.Builder().build(),
                () -> UserMessagingPlatform.loadAndShowConsentFormIfRequired(this, error -> startAds()),
                error -> startAds());
        startAds();
    }

    private void startAds() {
        if (!consent.canRequestAds() || !adsStarted.compareAndSet(false, true)) return;
        new Thread(() -> {
            MobileAds.initialize(this, status -> {
            });
            runOnUiThread(this::loadBanner);
        }).start();
    }

    private void loadBanner() {
        if (isFinishing() || isDestroyed()) return;
        adView = new AdView(this);
        adView.setAdUnitId(BuildConfig.ADMOB_BANNER_ID);
        float density = getResources().getDisplayMetrics().density;
        int widthDp = (int) (getResources().getDisplayMetrics().widthPixels / density);
        adView.setAdSize(AdSize.getLargeAnchoredAdaptiveBannerAdSize(this, widthDp));
        adBox.addView(adView);
        adView.loadAd(new AdRequest.Builder().build());
    }

    private void removeWebView() {
        if (webView == null) return;
        root.removeView(webView);
        webView.destroy();
        webView = null;
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
        if (adView != null) adView.pause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        if (adView != null) adView.resume();
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (adView != null) adView.destroy();
        removeWebView();
        super.onDestroy();
    }
}
