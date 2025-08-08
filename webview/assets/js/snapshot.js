const snapshotContainerNode = document.querySelector(".snapshot-container");
const snapshotContainerBackgroundNode = document.querySelector(
  ".snapshot-container__background"
);
const terminalNode = document.querySelector(".terminal");
const exportFormatNode = document.getElementById("export-format");

export const takeSnapshot = (filename) => {
  snapshotContainerNode.style.resize = "none";
  terminalNode.style.resize = "none";

  const resetStyles = () => {
    snapshotContainerNode.style.resize = "";
    terminalNode.style.resize = "";
  };

  const options = {
    width: snapshotContainerBackgroundNode.offsetWidth * 2,
    height: snapshotContainerBackgroundNode.offsetHeight * 2,
    style: {
      transform: "scale(2)",
      transformOrigin: "center",
      background: "#e0eafc",
      background: "linear-gradient(to left, #e0eafc, #cfdef3)",
    },
  };

  const selectedValue = exportFormatNode.value;

  if (selectedValue === "svg") {
    domtoimage
      .toSvg(snapshotContainerBackgroundNode, options)
      .then(function (dataUrl) {
        resetStyles();
        const link = document.createElement("a");
        link.download = `devsnip-pro-${filename}.svg`;
        link.href = dataUrl;
        link.click();
      });
  } else if (selectedValue === "png") {
    domtoimage
      .toBlob(snapshotContainerBackgroundNode, options)
      .then(function (blob) {
        resetStyles();
        window.saveAs(blob, `devsnip-pro-${filename}.${selectedValue}`);
      });
  } else {
    domtoimage
      .toBlob(snapshotContainerBackgroundNode, options)
      .then(function (blob) {
        resetStyles();
        window.saveAs(blob, `devsnip-pro-${filename}.jpg`);
      });
  }
};
