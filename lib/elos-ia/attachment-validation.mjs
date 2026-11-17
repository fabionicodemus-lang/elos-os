/** Validate bytes, not only the filename/MIME reported by the browser. */
export function validateDocumentBytes(bytes, mimeType) {
  const starts = (...values) => values.every((value, index) => bytes[index] === value);
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  let valid = false;
  if (mimeType === "application/pdf") valid = head.includes("%PDF-");
  else if (mimeType === "image/png") valid = starts(137, 80, 78, 71, 13, 10, 26, 10);
  else if (mimeType === "image/jpeg") valid = starts(255, 216, 255);
  else if (mimeType === "image/webp") valid = head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
  else if (mimeType.includes("openxmlformats")) valid = starts(80, 75, 3, 4);
  else if (["application/msword", "application/vnd.ms-excel"].includes(mimeType)) valid = starts(208, 207, 17, 224, 161, 177, 26, 225);
  else if (["text/plain", "text/csv"].includes(mimeType)) valid = bytes.length > 0 && !bytes.includes(0);
  if (!valid) throw new Error("O conteúdo do arquivo não corresponde ao formato informado. Exporte novamente como PDF, imagem ou texto UTF-8.");
}
