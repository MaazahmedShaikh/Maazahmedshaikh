const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Custom Expo Config Plugin for Android that adds a BroadcastReceiver
 * listening for android.provider.Telephony.SECRET_CODE to launch MainActivity
 * when *#*#7391#*#* is dialed in the phone dialer, plus optional launcher icon removal.
 */
const withSecretDialer = (config, props = {}) => {
  return withAndroidManifest(config, async (manifestConfig) => {
    const androidManifest = manifestConfig.modResults.manifest;
    const mainApplication = androidManifest.application?.[0];

    if (!mainApplication) {
      return manifestConfig;
    }

    // Optional: strip launcher category if HIDE_LAUNCHER_ICON is enabled
    if (props.hideLauncherIcon || process.env.HIDE_LAUNCHER_ICON === 'true') {
      if (mainApplication.activity) {
        mainApplication.activity.forEach((activity) => {
          if (activity['intent-filter']) {
            activity['intent-filter'] = activity['intent-filter'].map((filter) => {
              if (filter.category) {
                filter.category = filter.category.filter(
                  (cat) => cat.$?.['android:name'] !== 'android.intent.category.LAUNCHER'
                );
              }
              return filter;
            });
          }
        });
      }
    }

    const secretCode = props.secretCode || '7391';

    if (!mainApplication.receiver) {
      mainApplication.receiver = [];
    }

    // Filter out existing receiver if previously added
    mainApplication.receiver = mainApplication.receiver.filter(
      (r) => r.$?.['android:name'] !== '.SecretDialerReceiver'
    );

    // Add Secret Code BroadcastReceiver
    mainApplication.receiver.push({
      $: {
        'android:name': '.SecretDialerReceiver',
        'android:exported': 'true',
      },
      'intent-filter': [
        {
          action: [
            {
              $: {
                'android:name': 'android.provider.Telephony.SECRET_CODE',
              },
            },
          ],
          data: [
            {
              $: {
                'android:scheme': 'android_secret_code',
                'android:host': secretCode,
              },
            },
          ],
        },
      ],
    });

    return manifestConfig;
  });
};

module.exports = withSecretDialer;
