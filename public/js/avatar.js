import Cropper from "https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.esm.js";

let cropper;

window.openUpload = function () {
  document.getElementById("fileInput")?.click();
};

document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("fileInput");
  const zoomSlider = document.getElementById("zoomSlider");

fileInput?.addEventListener("change", (e) => {
  if (cropper) cropper.destroy();

  const file = e.target.files[0];
  if (!file || !file.type.startsWith("image/")) return;

  const url = URL.createObjectURL(file);

  const img = document.getElementById("preview");
  const previewSmall = document.getElementById("preview-small");

  img.src = url;
  previewSmall.src = url;

  document.getElementById("modal").style.display = "flex";

  cropper = new Cropper(img, {
    aspectRatio: 1,
    viewMode: 1,
    dragMode: "move",
    autoCropArea: 1,
    background: false,
    responsive: true,

    crop() {
      const canvas = cropper.getCroppedCanvas({
        width: 150,
        height: 150
      });

      if (canvas) {
        previewSmall.src = canvas.toDataURL();
      }
    }
  });

  // 🔥 smooth zoom reset
  zoomSlider.value = 1;

  zoomSlider.oninput = () => {
    if (!cropper) return;
    cropper.zoomTo(parseFloat(zoomSlider.value));
  };
});
  // ESC bezárás
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal();
    }
  });
});

window.closeModal = function () {
  document.getElementById("modal").style.display = "none";
  if (cropper) {
    cropper.destroy();
    cropper = null;
  }
}
window.saveAvatar = async function () {
  if (!cropper) return;

  const canvas = cropper.getCroppedCanvas({
    width: 300,
    height: 300
  });

  const blob = await new Promise((res) => canvas.toBlob(res));

  const formData = new FormData();
  formData.append("avatar", blob);

  const res = await fetch("/api/user/avatar", {
    method: "POST",
    body: formData
  });

  const data = await res.json();

  document.getElementById("avatar").src = data.avatar + "?t=" + Date.now();

  closeModal();
};
