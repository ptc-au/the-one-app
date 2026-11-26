// A drop zone, with its state and no look, as react-dropzone's `useDropzone` has it: whether files from the system are
// dragged over it now (its `isDragActive`), what it takes of them (`accept`, as `<input type="file">`'s, and `multiple`),
// and the device's picker for the same (its `open`), which is the way in where nothing is dragged (a phone).
import { createSignal } from "solid-js"
import { pickFiles } from "#bridge"

/** A drop zone's props: what it takes, one or many, and what's told them. */
export interface DropZoneState {
  accept?: string[]
  multiple?: boolean
  onDrop: (files: File[]) => void
}

/** Whether `file` is one of `accept`'s kinds, as a browser's picker takes it: by its extension (`.pdf`), its type
 * (`application/pdf`), or its type's family (`image/*`); any where it says none. */
const accepts = (file: File, accept: string[]) =>
  !accept.length ||
  accept.some((kind) => {
    const it = kind.trim().toLowerCase()
    if (it.startsWith(".")) return file.name.toLowerCase().endsWith(it)
    if (it.endsWith("/*")) return file.type.startsWith(it.slice(0, -1))
    return file.type === it
  })

/** `const zone = createDropZone(props)`, then `<View {...zone.root()}>`, `zone.dragging()` for how it looks, and
 * `zone.open()` for its Choose Files. */
export function createDropZone(props: DropZoneState) {
  const [dragging, setDragging] = createSignal(false)
  const take = (files: File[]) => {
    const taken = files.filter((file) => accepts(file, props.accept ?? []))
    const kept = props.multiple ? taken : taken.slice(0, 1)
    if (kept.length) props.onDrop(kept)
  }
  return {
    dragging,
    open: async () => take(await pickFiles({ accept: props.accept, multiple: props.multiple })),
    root: () => ({
      onDrop: (files: File[]) => (setDragging(false), take(files)),
      onDragEnter: () => setDragging(true),
      onDragLeave: () => setDragging(false),
    }),
  }
}
