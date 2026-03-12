const mammoth = require("mammoth");
const fs = require("fs");
const path = require("path");

const docxPath = path.join(__dirname, "Brugervejledning - Leverandøradministratorer - Supplier Overview.EK2025.docx");
const imgDir = path.join(__dirname, "static", "img", "docx");

// Ensure image directory exists
if (!fs.existsSync(imgDir)) {
  fs.mkdirSync(imgDir, { recursive: true });
}

let imgCounter = 0;

const options = {
  convertImage: mammoth.images.imgElement(function (image) {
    return image.read("base64").then(function (imageBuffer) {
      const ext = image.contentType.split("/")[1] || "png";
      const filename = `docx_img_${String(++imgCounter).padStart(3, "0")}.${ext}`;
      const filepath = path.join(imgDir, filename);
      fs.writeFileSync(filepath, Buffer.from(imageBuffer, "base64"));
      return { src: `/img/docx/${filename}` };
    });
  }),
};

async function extract() {
  // Extract as HTML first for full structure
  const htmlResult = await mammoth.convertToHtml({ path: docxPath }, options);
  fs.writeFileSync(
    path.join(__dirname, "extracted_guide.html"),
    htmlResult.value,
    "utf8"
  );
  console.log("HTML extracted to extracted_guide.html");
  console.log("Warnings:", htmlResult.messages.length);
  htmlResult.messages.forEach((m) => console.log(" -", m.message));

  // Also extract raw text for reference
  const textResult = await mammoth.extractRawText({ path: docxPath });
  fs.writeFileSync(
    path.join(__dirname, "extracted_guide.txt"),
    textResult.value,
    "utf8"
  );
  console.log("Text extracted to extracted_guide.txt");
  console.log(`Images extracted: ${imgCounter}`);
}

extract().catch(console.error);
