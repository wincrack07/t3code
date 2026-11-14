import { useState } from "react";
import { FolderIcon, ArrowUpIcon } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  ensureBrowseDirectoryPath,
  getBrowseParentPath,
} from "@t3tools/client-runtime/state/projects";
import { filesystemEnvironment } from "../state/filesystem";
import { useEnvironmentQuery } from "../state/query";
import { useDebouncedValue } from "../state/queries";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "./ui/dialog";

export function WorkspaceFolderPicker({
  environmentId,
  value,
  disabled,
  onChange,
}: {
  environmentId: EnvironmentId;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" disabled={disabled} />}>
        Browse…
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Choose folder</DialogTitle>
        </DialogHeader>
        {open ? (
          <FolderBrowser
            environmentId={environmentId}
            initialPath={value}
            onChoose={(path) => {
              onChange(path);
              setOpen(false);
            }}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function FolderBrowser({
  environmentId,
  initialPath,
  onChoose,
}: {
  environmentId: EnvironmentId;
  initialPath: string;
  onChoose: (path: string) => void;
}) {
  const [path, setPath] = useState(initialPath.trim() || "~/");
  const requestedPath = ensureBrowseDirectoryPath(path.trim() || "~/");
  const browsePath = useDebouncedValue(requestedPath, 120);
  const query = useEnvironmentQuery(
    filesystemEnvironment.browse({
      environmentId,
      input: { partialPath: browsePath },
    }),
  );
  const parent = query.data ? getBrowseParentPath(query.data.parentPath) : null;
  return (
    <>
      <DialogPanel>
        <div className="flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Parent folder"
            disabled={!parent}
            onClick={() => {
              if (parent) setPath(parent);
            }}
          >
            <ArrowUpIcon />
          </Button>
          <Input
            aria-label="Folder path"
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
        </div>
        <div className="mt-3 max-h-72 overflow-y-auto" aria-label="Folders">
          {query.data?.entries.map((entry) => (
            <div key={entry.fullPath}>
              <Button variant="ghost" size="sm" onClick={() => setPath(entry.fullPath)}>
                <FolderIcon />
                {entry.name}
              </Button>
            </div>
          ))}
          {query.error ? (
            <p role="alert" className="py-3 text-sm text-muted-foreground">
              Could not read this folder. Enter an existing path on the destination environment.
            </p>
          ) : query.data?.entries.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No subfolders</p>
          ) : null}
        </div>
      </DialogPanel>
      <DialogFooter variant="bare">
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button
          disabled={
            !query.data || query.error !== null || query.isPending || browsePath !== requestedPath
          }
          onClick={() => {
            if (query.data) onChoose(query.data.parentPath);
          }}
        >
          Use this folder
        </Button>
      </DialogFooter>
    </>
  );
}
