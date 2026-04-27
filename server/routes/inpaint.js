// server/routes/inpaint.js - LaMa Cleaner 1.2.5
import express from "express";
import fetch   from "node-fetch";

const router   = express.Router();
const LAMA_URL = process.env.LAMA_URL || "http://192.168.0.90:8080";

router.post("/", async (req, res) => {
  req.setTimeout(660000);
  res.setTimeout(660000);

  try {
    const { imageBase64, maskBase64 } = req.body;
    if (!imageBase64 || !maskBase64)
      return res.status(400).json({ error: "image és mask szükséges" });

    const imgBuf  = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    const maskBuf = Buffer.from(maskBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");

    const boundary = "----LamaBoundary" + Date.now();

    const addFile = (name, buf, filename) => [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
      buf,
      Buffer.from("\r\n")
    ];

    const addField = (name, value) => [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
    ];

    const body = Buffer.concat([
      ...addFile("image", imgBuf,  "image.png"),
      ...addFile("mask",  maskBuf, "mask.png"),
      ...addField("ldmSteps",                     "25"),
      ...addField("ldmSampler",                   "plms"),
      ...addField("hdStrategy",                   "Crop"),
      ...addField("zitsWireframe",                "true"),
      ...addField("hdStrategyCropMargin",          "196"),
      ...addField("hdStrategyCropTrigerSize",      "800"),
      ...addField("hdStrategyResizeLimit",         "2048"),
      ...addField("prompt",                        ""),
      ...addField("negativePrompt",                ""),
      ...addField("useCroper",                     "false"),
      ...addField("croperX",                       "0"),
      ...addField("croperY",                       "0"),
      ...addField("croperHeight",                  "512"),
      ...addField("croperWidth",                   "512"),
      ...addField("sdScale",                       "1"),
      ...addField("sdMaskBlur",                    "5"),
      ...addField("sdStrength",                    "0.75"),
      ...addField("sdSteps",                       "50"),
      ...addField("sdGuidanceScale",               "7.5"),
      ...addField("sdSampler",                     "uni_pc"),
      ...addField("sdSeed",                        "-1"),
      ...addField("sdMatchHistograms",             "false"),
      ...addField("cv2Flag",                       "INPAINT_NS"),
      ...addField("cv2Radius",                     "4"),
      ...addField("paintByExampleSteps",           "50"),
      ...addField("paintByExampleGuidanceScale",   "7.5"),
      ...addField("paintByExampleMaskBlur",        "5"),
      ...addField("paintByExampleSeed",            "-1"),
      ...addField("paintByExampleMatchHistograms", "false"),
      ...addField("p2pSteps",                      "50"),
      ...addField("p2pImageGuidanceScale",         "1.5"),
      ...addField("p2pGuidanceScale",              "7.5"),
      ...addField("controlnet_conditioning_scale", "0.4"),
      ...addField("controlnet_method",             "control_v11p_sd15_canny"),
      Buffer.from(`--${boundary}--\r\n`)
    ]);

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 600000);

    let lamaRes;
    try {
      lamaRes = await fetch(`${LAMA_URL}/inpaint`, {
        method:  "POST",
        body,
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
        signal:  controller.signal
      });
      clearTimeout(timeoutId);
    } catch (e) {
      clearTimeout(timeoutId);
      return res.status(504).json({ error: "LaMa timeout: " + e.message });
    }

    if (!lamaRes.ok) {
      const errText = await lamaRes.text().catch(() => "?");
      return res.status(500).json({ error: "LaMa hiba (" + lamaRes.status + "): " + errText.slice(0, 300) });
    }

    const imgBuffer = await lamaRes.buffer();
    const b64 = "data:image/png;base64," + imgBuffer.toString("base64");
    return res.json({ image: b64 });

  } catch (e) {
    console.error("[inpaint]", e);
    return res.status(500).json({ error: e.message });
  }
});

export default router;
