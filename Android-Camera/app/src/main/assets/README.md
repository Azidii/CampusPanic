# Android Camera Model Assets

Place your trained YOLO11 / YOLOv8 single-class TFLite model file in this folder:

```
Android-Camera/app/src/main/assets/gun_model.tflite
```

### Model Specifications Expected by `GunDetector.kt`:
* **File name**: `gun_model.tflite`
* **Input tensor**: `[1, 3, 640, 640]` float32 (RGB, CHW layout, normalized 0.0 to 1.0)
* **Output tensor**: `[1, 5, 8400]` float32 (normalized `xywh` + gun confidence score)
* **Packaging**: Uncompressed in APK (`noCompress.add("tflite")` configured in `build.gradle.kts`)

Once you drop `gun_model.tflite` here, build the APK:
```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-22"
cd Android-Camera
.\gradlew.bat assembleDebug
```
The resulting APK will have the on-device gun detection CNN ready to run.

