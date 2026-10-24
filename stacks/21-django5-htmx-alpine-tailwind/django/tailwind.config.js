/** Tailwind content scan for the Django templates. Built output is committed;
 *  rebuild with: tailwindcss -i static/css/input.css -o static/css/tailwind.css --minify */
module.exports = {
  content: ["./templates/**/*.html", "./**/*.py"],
  theme: { extend: {} },
  corePlugins: { preflight: true },
};
