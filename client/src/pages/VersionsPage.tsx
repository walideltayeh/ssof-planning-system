import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Save,
  Upload,
  Download,
  Trash2,
  FileText,
  RotateCcw,
  HardDrive,
  Cloud,
  Clock,
  User,
  Package,
  AlertTriangle,
} from "lucide-react";
import VersionComparison from "@/components/VersionComparison";
import VersionComments from "@/components/VersionComments";

export default function VersionsPage() {
  const { isAdmin } = useAppAuth();

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [versionName, setVersionName] = useState("");
  const [versionDescription, setVersionDescription] = useState("");
  const [loadConfirmId, setLoadConfirmId] = useState<number | null>(null);
  const [loadConfirmName, setLoadConfirmName] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [importConfirmData, setImportConfirmData] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const versionsQuery = trpc.versions.list.useQuery();
  const editCountQuery = trpc.versions.editCount.useQuery({});
  const saveMutation = trpc.versions.save.useMutation();
  const loadMutation = trpc.versions.load.useMutation();
  const deleteMutation = trpc.versions.delete.useMutation();
  const importMutation = trpc.versions.import.useMutation();

  const handleSave = async () => {
    if (!versionName.trim()) {
      toast.error("Please enter a version name");
      return;
    }
    try {
      const result = await saveMutation.mutateAsync({
        name: versionName.trim(),
        description: versionDescription.trim() || undefined,
      });
      toast.success(`Version "${versionName}" saved successfully!`, {
        description: result.docUrl
          ? "Word document generated and attached."
          : "Version snapshot saved.",
      });
      setSaveDialogOpen(false);
      setVersionName("");
      setVersionDescription("");
      versionsQuery.refetch();
      editCountQuery.refetch();
    } catch (err: any) {
      toast.error("Failed to save version", {
        description: err.message || "Unknown error",
      });
    }
  };

  const handleLoad = async (id: number) => {
    try {
      const result = await loadMutation.mutateAsync({ id });
      toast.success(`Version "${result.name}" loaded successfully!`, {
        description:
          "All data has been restored. Refresh any open pages to see the changes.",
      });
      setLoadConfirmId(null);
      versionsQuery.refetch();
      editCountQuery.refetch();
    } catch (err: any) {
      toast.error("Failed to load version", {
        description: err.message || "Unknown error",
      });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMutation.mutateAsync({ id });
      toast.success(`Version "${deleteConfirmName}" deleted`);
      setDeleteConfirmId(null);
      versionsQuery.refetch();
    } catch (err: any) {
      toast.error("Failed to delete version", {
        description: err.message || "Unknown error",
      });
    }
  };

  const handleExport = async (id: number, name: string) => {
    try {
      const response = await fetch(
        `/api/trpc/versions.export?input=${encodeURIComponent(JSON.stringify({ id }))}`
      );
      const json = await response.json();
      const data = json.result?.data;
      if (!data) throw new Error("No data returned");

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.ssof.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported "${name}" to file`);
    } catch (err: any) {
      toast.error("Failed to export version", {
        description: err.message || "Unknown error",
      });
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (!data.snapshotData) {
          toast.error("Invalid version file", {
            description: "The file does not contain valid SSOF snapshot data.",
          });
          return;
        }
        setImportConfirmData(data);
      } catch {
        toast.error("Failed to read file", {
          description: "The file is not valid JSON.",
        });
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImportConfirm = async () => {
    if (!importConfirmData) return;
    try {
      const result = await importMutation.mutateAsync({
        versionData: importConfirmData,
      });
      toast.success(`Version "${result.name}" imported and loaded!`, {
        description:
          "All data has been restored from the imported file. Refresh any open pages.",
      });
      setImportConfirmData(null);
      versionsQuery.refetch();
      editCountQuery.refetch();
    } catch (err: any) {
      toast.error("Failed to import version", {
        description: err.message || "Unknown error",
      });
    }
  };

  const versions = versionsQuery.data || [];
  const editCount = editCountQuery.data?.count ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            SSOF Version Manager
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Save, load, compare, and annotate SSOF data snapshots
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Compare button */}
          <VersionComparison versions={versions} />

          {/* Import from device */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.ssof.json"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={!isAdmin}
          >
            <Upload className="h-4 w-4 mr-2" />
            Import from Device
          </Button>

          {/* Save new version */}
          <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
            <DialogTrigger asChild>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={!isAdmin}
              >
                <Save className="h-4 w-4 mr-2" />
                Save Current Version
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Save SSOF Version</DialogTitle>
                <DialogDescription>
                  Save the current state of all data as a named version. A Word
                  document summarizing changes will be auto-generated.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Version Name *
                  </label>
                  <Input
                    placeholder="e.g., SSOFv1, March 2025 Baseline, Pre-Season Plan"
                    value={versionName}
                    onChange={(e) => setVersionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSave();
                    }}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Description (optional)
                  </label>
                  <Textarea
                    placeholder="Describe what this version represents or what changes were made..."
                    value={versionDescription}
                    onChange={(e) => setVersionDescription(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setSaveDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!versionName.trim() || saveMutation.isPending}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  {saveMutation.isPending ? (
                    <>
                      <span className="animate-spin mr-2">&#9203;</span>
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save Version
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Unsaved edits banner */}
      {editCount > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-center gap-3 py-3">
            <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-amber-800">
                {editCount} unsaved edit{editCount !== 1 ? "s" : ""} since last version
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                Consider saving a new version to preserve your recent changes.
              </p>
            </div>
            <Button
              size="sm"
              className="bg-amber-600 hover:bg-amber-700"
              onClick={() => setSaveDialogOpen(true)}
              disabled={!isAdmin}
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save Now
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Versions List */}
      {versionsQuery.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
        </div>
      ) : versions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-1">No Saved Versions</h3>
            <p className="text-muted-foreground text-sm text-center max-w-md">
              Save your first version to create a snapshot of all SSOF data.
              Each version includes a Word document summarizing all changes
              made.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {versions.map((version, idx) => (
            <Card
              key={version.id}
              className={`transition-all hover:shadow-md ${
                idx === 0 ? "border-emerald-200 bg-emerald-50/30" : ""
              }`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                        idx === 0
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      <Cloud className="h-5 w-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg flex items-center gap-2">
                        {version.name}
                        {idx === 0 && (
                          <Badge
                            variant="secondary"
                            className="bg-emerald-100 text-emerald-700 text-xs"
                          >
                            Latest
                          </Badge>
                        )}
                      </CardTitle>
                      {version.description && (
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {version.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {version.docUrl && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-blue-600 border-blue-200 hover:bg-blue-50"
                        onClick={() =>
                          window.open(version.docUrl!, "_blank")
                        }
                      >
                        <FileText className="h-3.5 w-3.5 mr-1.5" />
                        Word Doc
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleExport(version.id, version.name)
                      }
                    >
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      Export
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-amber-600 border-amber-200 hover:bg-amber-50"
                      disabled={!isAdmin}
                      onClick={() => {
                        setLoadConfirmId(version.id);
                        setLoadConfirmName(version.name);
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                      Load
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-200 hover:bg-red-50"
                      disabled={!isAdmin}
                      onClick={() => {
                        setDeleteConfirmId(version.id);
                        setDeleteConfirmName(version.name);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {version.savedBy}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(version.createdAt).toLocaleString()}
                  </span>
                  <span className="flex items-center gap-1">
                    <HardDrive className="h-3 w-3" />
                    Full data snapshot
                  </span>
                </div>

                {/* Version Comments */}
                <VersionComments versionId={version.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Load Confirmation Dialog */}
      <AlertDialog
        open={loadConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) setLoadConfirmId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Load Version "{loadConfirmName}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace ALL current data (SKUs, Forecast, IMS, Shipment,
              Arrival, Planning FG) with the data from this saved version. This
              action cannot be undone. Make sure to save the current state first
              if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => loadConfirmId && handleLoad(loadConfirmId)}
              className="bg-amber-600 hover:bg-amber-700"
              disabled={loadMutation.isPending}
            >
              {loadMutation.isPending ? "Loading..." : "Yes, Load Version"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete Version "{deleteConfirmName}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this saved version and its associated
              Word document. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Yes, Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Confirmation Dialog */}
      <AlertDialog
        open={importConfirmData !== null}
        onOpenChange={(open) => {
          if (!open) setImportConfirmData(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Import Version "{importConfirmData?.name || "Unknown"}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will replace ALL current data with the data from the imported
              file. The imported version was originally saved by{" "}
              <strong>{importConfirmData?.savedBy || "unknown"}</strong> on{" "}
              <strong>
                {importConfirmData?.createdAt
                  ? new Date(importConfirmData.createdAt).toLocaleString()
                  : "unknown date"}
              </strong>
              . This action cannot be undone. Make sure to save the current state
              first if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleImportConfirm}
              className="bg-amber-600 hover:bg-amber-700"
              disabled={importMutation.isPending}
            >
              {importMutation.isPending
                ? "Importing..."
                : "Yes, Import & Load"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
