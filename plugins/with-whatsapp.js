const { withAndroidManifest } = require("expo/config-plugins");
module.exports = function withWhatsApp(config) {
  return withAndroidManifest(config, (config) => {
    // Local HTTP conversion is allowed only for development APKs; releases use HTTPS.
    if (process.env.PEEL_LOCAL_CONVERTER === "1")
      config.modResults.manifest.application[0].$[
        "android:usesCleartextTraffic"
      ] = "true";
    return config;
  });
};
