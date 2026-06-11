/** The compiled thesis, served by the backend at /thesis.pdf. The browser's
 *  native PDF viewer provides search and navigation; thesis citations open
 *  this same file in a new tab. */
export function PdfView() {
  return (
    <div className="pdf-view">
      <iframe src="/thesis.pdf" title="Thesis PDF" />
    </div>
  );
}
