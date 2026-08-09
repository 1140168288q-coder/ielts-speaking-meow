package com.ieltsspeakingmeow.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/** Local, bundled Latin-script OCR for imported question documents. */
@CapacitorPlugin(name = "DocumentOcr")
public class DocumentOcrPlugin extends Plugin {
    private static final int MAX_BASE64_CHARACTERS = 23_000_000;
    private static final int MAX_DECODED_BYTES = 16 * 1024 * 1024;
    private static final int MAX_SOURCE_DIMENSION = 20_000;
    private static final long MAX_SOURCE_PIXELS = 50_000_000L;
    private static final int MAX_DECODED_DIMENSION = 4_096;
    private static final long MAX_DECODED_PIXELS = 4_000_000L;

    private final AtomicBoolean recognitionInProgress = new AtomicBoolean(false);

    @PluginMethod
    public void recognizeBase64(PluginCall call) {
        if (!recognitionInProgress.compareAndSet(false, true)) {
            call.reject("Document OCR is already processing an image.", "OCR_BUSY");
            return;
        }

        Bitmap bitmap = null;
        try {
            String encodedImage = call.getString("dataUrl");
            if (encodedImage == null) {
                encodedImage = call.getString("base64");
            }
            String payload = extractBase64Payload(encodedImage);
            byte[] bytes = decodeBase64(payload);
            bitmap = decodeBoundedBitmap(bytes);
            bitmap = applyExifRotation(bytes, bitmap);
            recognize(call, bitmap);
        } catch (OcrInputException error) {
            recycle(bitmap);
            recognitionInProgress.set(false);
            call.reject(error.getMessage(), error.code);
        } catch (OutOfMemoryError error) {
            recycle(bitmap);
            recognitionInProgress.set(false);
            call.reject("The image is too large to process safely.", "DECODE_FAILED");
        } catch (RuntimeException error) {
            recycle(bitmap);
            recognitionInProgress.set(false);
            call.reject("The image could not be prepared for OCR.", "DECODE_FAILED");
        }
    }

    private void recognize(PluginCall call, Bitmap bitmap) {
        TextRecognizer recognizer = TextRecognition.getClient(
            TextRecognizerOptions.DEFAULT_OPTIONS
        );
        InputImage image = InputImage.fromBitmap(bitmap, 0);

        try {
            recognizer
                .process(image)
                .addOnCompleteListener(task -> {
                    recycle(bitmap);
                    recognizer.close();
                    recognitionInProgress.set(false);

                    if (!task.isSuccessful()) {
                        call.reject("Text recognition failed.", "OCR_FAILED");
                        return;
                    }

                    Text result = task.getResult();
                    JSObject response = new JSObject();
                    response.put("text", result == null ? "" : result.getText().trim());
                    call.resolve(response);
                });
        } catch (RuntimeException error) {
            recycle(bitmap);
            recognizer.close();
            recognitionInProgress.set(false);
            call.reject("Text recognition could not be started.", "OCR_FAILED");
        }
    }

    private static String extractBase64Payload(String input) throws OcrInputException {
        if (input == null || input.trim().isEmpty()) {
            throw new OcrInputException("INVALID_INPUT", "An image is required for OCR.");
        }
        if (input.length() > MAX_BASE64_CHARACTERS) {
            throw new OcrInputException("INPUT_TOO_LARGE", "The OCR image exceeds the 16 MB limit.");
        }

        if (!input.regionMatches(true, 0, "data:", 0, 5)) {
            return input;
        }

        int separator = input.indexOf(',');
        if (separator < 0) {
            throw new OcrInputException("INVALID_INPUT", "The image data URL is malformed.");
        }

        String metadata = input.substring(5, separator).toLowerCase(Locale.ROOT);
        if (
            !metadata.endsWith(";base64") ||
            !(metadata.startsWith("image/jpeg") ||
                metadata.startsWith("image/jpg") ||
                metadata.startsWith("image/png"))
        ) {
            throw new OcrInputException(
                "INVALID_INPUT",
                "Only base64-encoded JPG and PNG images are supported."
            );
        }
        return input.substring(separator + 1);
    }

    private static byte[] decodeBase64(String payload) throws OcrInputException {
        if (payload.length() > MAX_BASE64_CHARACTERS) {
            throw new OcrInputException("INPUT_TOO_LARGE", "The OCR image exceeds the 16 MB limit.");
        }

        long estimatedBytes = ((long) payload.length() + 3L) / 4L * 3L;
        if (estimatedBytes > MAX_DECODED_BYTES + 3L) {
            throw new OcrInputException("INPUT_TOO_LARGE", "The OCR image exceeds the 16 MB limit.");
        }

        final byte[] decoded;
        try {
            decoded = Base64.decode(payload, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            throw new OcrInputException("INVALID_INPUT", "The image is not valid base64 data.");
        }

        if (decoded.length == 0) {
            throw new OcrInputException("INVALID_INPUT", "The OCR image is empty.");
        }
        if (decoded.length > MAX_DECODED_BYTES) {
            throw new OcrInputException("INPUT_TOO_LARGE", "The OCR image exceeds the 16 MB limit.");
        }
        return decoded;
    }

    private static Bitmap decodeBoundedBitmap(byte[] bytes) throws OcrInputException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);

        int width = bounds.outWidth;
        int height = bounds.outHeight;
        if (width <= 0 || height <= 0) {
            throw new OcrInputException("DECODE_FAILED", "The JPG or PNG image could not be decoded.");
        }

        long sourcePixels = (long) width * (long) height;
        if (
            width > MAX_SOURCE_DIMENSION ||
            height > MAX_SOURCE_DIMENSION ||
            sourcePixels > MAX_SOURCE_PIXELS
        ) {
            throw new OcrInputException("IMAGE_TOO_LARGE", "The image dimensions are too large to process safely.");
        }

        int sampleSize = 1;
        while (
            Math.max(width / sampleSize, height / sampleSize) > MAX_DECODED_DIMENSION ||
            ((long) width / sampleSize) * ((long) height / sampleSize) > MAX_DECODED_PIXELS
        ) {
            sampleSize *= 2;
        }

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sampleSize;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (bitmap == null) {
            throw new OcrInputException("DECODE_FAILED", "The JPG or PNG image could not be decoded.");
        }
        return bitmap;
    }

    private static Bitmap applyExifRotation(byte[] bytes, Bitmap bitmap) {
        final int orientation;
        try {
            ExifInterface exif = new ExifInterface(new ByteArrayInputStream(bytes));
            orientation = exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            );
        } catch (IOException | RuntimeException ignored) {
            return bitmap;
        }

        float rotation;
        if (orientation == ExifInterface.ORIENTATION_ROTATE_90) {
            rotation = 90f;
        } else if (orientation == ExifInterface.ORIENTATION_ROTATE_180) {
            rotation = 180f;
        } else if (orientation == ExifInterface.ORIENTATION_ROTATE_270) {
            rotation = 270f;
        } else {
            return bitmap;
        }

        Matrix matrix = new Matrix();
        matrix.postRotate(rotation);
        Bitmap rotated = Bitmap.createBitmap(
            bitmap,
            0,
            0,
            bitmap.getWidth(),
            bitmap.getHeight(),
            matrix,
            true
        );
        if (rotated != bitmap) {
            bitmap.recycle();
        }
        return rotated;
    }

    private static void recycle(Bitmap bitmap) {
        if (bitmap != null && !bitmap.isRecycled()) {
            bitmap.recycle();
        }
    }

    private static final class OcrInputException extends Exception {
        final String code;

        OcrInputException(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
