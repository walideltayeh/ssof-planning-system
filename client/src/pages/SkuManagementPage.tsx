import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useCountry } from "@/contexts/CountryContext";
import { useAppAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, Package, GripVertical, Download } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ─── Sortable Row Component ───────────────────────────────────────────────────
function SortableSkuRow({
  sku,
  index,
  onDelete,
  deleteConfirm,
  onCategoryToggle,
  onToggleActive,
  isAdmin,
}: {
  sku: any;
  index: number;
  onDelete: (id: number) => void;
  deleteConfirm: number | null;
  onCategoryToggle: (id: number, current: string) => void;
  onToggleActive: (sku: any) => void;
  isAdmin: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sku.id });
  const inactive = sku.isActive === false;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : inactive ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-t border-border/50 hover:bg-muted/30 transition-colors group ${isDragging ? "bg-muted shadow-lg" : ""} ${inactive ? "bg-muted/20" : ""}`}
    >
      <td className="px-4 py-2.5 text-muted-foreground text-xs">{index + 1}</td>
      <td className="px-2 py-2.5 w-8">
        {isAdmin && (
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing p-1 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors touch-none"
            title="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
      </td>
      <td className={`px-4 py-2.5 font-medium ${inactive ? "line-through text-muted-foreground" : ""}`}>{sku.name}</td>
      <td className="px-4 py-2.5 text-muted-foreground">{sku.weight}</td>
      <td className="px-4 py-2.5">
        <button
          onClick={() => onCategoryToggle(sku.id, sku.category)}
          className={`px-2 py-0.5 rounded text-xs font-semibold border transition-colors ${sku.category === "Core" ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" : "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100"}`}
          title="Click to toggle category"
          disabled={!isAdmin}
        >{sku.category}</button>
      </td>
      <td className="px-4 py-2.5">
        <button
          onClick={() => onToggleActive(sku)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
            !inactive ? "bg-emerald-500" : "bg-gray-300"
          }`}
          title={!inactive ? "Click to disable SKU" : "Click to enable SKU"}
          disabled={!isAdmin}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            !inactive ? "translate-x-4" : "translate-x-0.5"
          }`} />
        </button>
      </td>
      <td className="px-4 py-2.5 text-right">
        {isAdmin && (
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onDelete(sku.id)}
              className={`p-1.5 rounded transition-colors text-xs ${deleteConfirm === sku.id ? "bg-destructive text-destructive-foreground" : "hover:bg-destructive/10 text-muted-foreground hover:text-destructive"}`}
              title={deleteConfirm === sku.id ? "Click again to confirm" : "Delete SKU"}
            >
              {deleteConfirm === sku.id ? "Confirm?" : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function exportSkusToExcel(skus: any[], country: string) {
  const headers = country === "Lebanon"
    ? ["#", "Name", "Weight", "Category", "Status"]
    : ["#", "Name", "Weight", "Category", "Packaging", "Status"];

  const rows = skus.map((sku: any, i: number) => {
    const base = [
      i + 1,
      sku.name,
      sku.weight,
      sku.category ?? "Core",
    ];
    if (country !== "Lebanon") base.push(sku.packagingType ?? "New");
    base.push(sku.isActive !== false ? "Active" : "Inactive");
    return base;
  });

  let csv = "\uFEFF";
  csv += headers.join(",") + "\n";
  for (const row of rows) {
    csv += row.map((v: any) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",") + "\n";
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `SKU_Management_${country}_${dateStr}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Lebanon SKU Management ──────────────────────────────────────────────────
function LebanonSkuManagement() {
  const { user: appUser } = useAppAuth();
  const utils = trpc.useUtils();
  const isAdmin = (appUser as any)?.role === "admin";

  const { data: skusData, isLoading } = trpc.country.skus.useQuery(
    { country: "Lebanon", includeInactive: true }
  );
  const [localSkus, setLocalSkus] = useState<any[] | null>(null);
  const displaySkus = localSkus ?? skusData ?? [];

  const createMutation = trpc.skus.create.useMutation({
    onSuccess: () => {
      utils.country.skus.invalidate();
      utils.data.forecast.invalidate();
      utils.data.planningFg.invalidate();
      toast.success("SKU created successfully");
    },
    onError: (err: any) => toast.error("Failed to create SKU: " + err.message),
  });

  const deleteMutation = trpc.skus.delete.useMutation({
    onSuccess: () => {
      utils.country.skus.invalidate();
      utils.data.forecast.invalidate();
      utils.data.planningFg.invalidate();
      toast.success("SKU deleted");
      setDeleteTarget(null);
    },
    onError: (err: any) => toast.error("Failed to delete: " + err.message),
  });

  const updateCategoryMutation = trpc.skus.updateCategory.useMutation({
    onMutate: async ({ id, category }) => {
      await utils.country.skus.cancel();
      const prev = utils.country.skus.getData({ country: "Lebanon", includeInactive: true });
      utils.country.skus.setData(
        { country: "Lebanon", includeInactive: true },
        (old: any) => old?.map((s: any) => (s.id === id ? { ...s, category } : s))
      );
      return { prev };
    },
    onError: (_err: any, _vars: any, ctx: any) => {
      if (ctx?.prev) utils.country.skus.setData({ country: "Lebanon", includeInactive: true }, ctx.prev);
      toast.error("Failed to update category");
    },
    onSettled: () => { utils.country.skus.invalidate(); },
  });

  const toggleActiveMutation = trpc.country.toggleSkuActive.useMutation({
    onMutate: async ({ skuId, isActive }) => {
      await utils.country.skus.cancel();
      const prev = utils.country.skus.getData({ country: "Lebanon", includeInactive: true });
      utils.country.skus.setData({ country: "Lebanon", includeInactive: true }, (old: any) =>
        old?.map((s: any) => s.id === skuId ? { ...s, isActive } : s)
      );
      setLocalSkus(prev => prev ? prev.map(s => s.id === skuId ? { ...s, isActive } : s) : null);
      return { prev };
    },
    onError: (_err: any, _vars: any, ctx: any) => {
      if (ctx?.prev) utils.country.skus.setData({ country: "Lebanon", includeInactive: true }, ctx.prev);
      setLocalSkus(null);
      toast.error("Failed to update SKU status");
    },
    onSettled: () => {
      utils.country.skus.invalidate();
      utils.data.forecast.invalidate();
      utils.data.planningFg.invalidate();
      utils.data.shipment.invalidate();
      utils.data.ims.invalidate();
      utils.data.arrival.invalidate();
    },
  });

  const reorderMutation = trpc.skus.reorder.useMutation({
    onError: () => {
      setLocalSkus(null);
      utils.country.skus.invalidate();
      toast.error("Failed to save order. Refreshing...");
    },
    onSuccess: () => { utils.country.skus.invalidate(); },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Form state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWeight, setNewWeight] = useState("50g");
  const [newCategory, setNewCategory] = useState<"Core" | "NPI">("Core");
  const [allSizes, setAllSizes] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [search, setSearch] = useState("");

  function resetCreateForm() {
    setNewName(""); setNewWeight("50g"); setNewCategory("Core"); setAllSizes(false);
  }

  // Sync localSkus when server data changes
  useMemo(() => {
    if (skusData && !localSkus) setLocalSkus(skusData as any[]);
  }, [skusData]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return displaySkus.filter((s: any) => !q || s.name.toLowerCase().includes(q) || s.weight.toLowerCase().includes(q));
  }, [displaySkus, search]);

  const stats = useMemo(() => ({
    total: displaySkus.length,
    active: displaySkus.filter((s: any) => s.isActive !== false).length,
    inactive: displaySkus.filter((s: any) => s.isActive === false).length,
    w50: displaySkus.filter((s: any) => s.weight === "50g").length,
    w250: displaySkus.filter((s: any) => s.weight === "250g").length,
    w1kg: displaySkus.filter((s: any) => s.weight === "1kg").length,
    core: displaySkus.filter((s: any) => s.category === "Core").length,
    npi: displaySkus.filter((s: any) => s.category === "NPI").length,
  }), [displaySkus]);

  const weightGroups = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const sku of filtered) {
      if (!groups[sku.weight]) groups[sku.weight] = [];
      groups[sku.weight].push(sku);
    }
    return groups;
  }, [filtered]);

  const weightOrder = ["50g", "250g", "1kg", ...Object.keys(weightGroups).filter(w => !["50g", "250g", "1kg"].includes(w))];

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const allSkusList = localSkus ?? skusData ?? [];
    const oldIndex = allSkusList.findIndex((s: any) => s.id === active.id);
    const newIndex = allSkusList.findIndex((s: any) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    if (allSkusList[oldIndex].weight !== allSkusList[newIndex].weight) {
      toast.error("SKUs can only be reordered within the same weight group.");
      return;
    }
    const newOrder = arrayMove(allSkusList, oldIndex, newIndex);
    setLocalSkus(newOrder);
    reorderMutation.mutate({ orderedIds: newOrder.map((s: any) => s.id)});
  }

  async function handleCreate() {
    if (!newName.trim()) { toast.error("Please enter a SKU name"); return; }
    if (allSizes) {
      for (const w of ["50g", "250g", "1kg"]) {
        await createMutation.mutateAsync({ name: newName.trim(), weight: w, category: newCategory});
      }
      utils.country.skus.invalidate();
      setLocalSkus(null);
      toast.success(`Created 3 SKUs (50g, 250g, 1kg) for "${newName.trim()}".`);
      setCreateOpen(false);
      resetCreateForm();
    } else {
      createMutation.mutate(
        { name: newName.trim(), weight: newWeight, category: newCategory},
        { onSuccess: () => { setCreateOpen(false); resetCreateForm(); } }
      );
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">SKU Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Lebanon — Create and manage SKUs. Drag rows to reorder within weight groups.</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => { exportSkusToExcel(displaySkus, "Lebanon"); toast.success("Downloading SKU list..."); }} disabled={!displaySkus.length}>
            <Download className="h-4 w-4" />Export
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />New SKU
          </Button>
        </div>
      </div>

      {/* Stats */}
      {stats.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {[
            { label: "Total SKUs", value: stats.total, color: "text-foreground" },
            { label: "Active", value: stats.active, color: "text-emerald-600" },
            { label: "Inactive", value: stats.inactive, color: "text-red-500" },
            { label: "50g", value: stats.w50, color: "text-blue-600" },
            { label: "250g", value: stats.w250, color: "text-indigo-600" },
            { label: "1kg", value: stats.w1kg, color: "text-violet-600" },
            { label: "Core", value: stats.core, color: "text-emerald-600" },
            { label: "NPI", value: stats.npi, color: "text-amber-600" },
          ].map(s => (
            <Card key={s.label} className="p-3">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && stats.total === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Package className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="font-semibold text-lg mb-2">No SKUs yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              Click <strong>New SKU</strong> to create your first SKU.
            </p>
            <Button onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="h-4 w-4" />New SKU</Button>
          </CardContent>
        </Card>
      )}

      {/* SKU Table */}
      {stats.total > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search SKUs..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
              </div>
              <span className="text-sm text-muted-foreground">{filtered.length} of {stats.total}</span>
              {reorderMutation.isPending && <span className="text-xs text-muted-foreground">Saving order...</span>}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <div className="overflow-auto max-h-[60vh]">
                {isLoading ? (
                  <div className="px-4 py-8 text-center text-muted-foreground">Loading...</div>
                ) : (
                  weightOrder.filter(w => weightGroups[w]?.length > 0).map(weight => (
                    <div key={weight}>
                      <div className="px-4 py-2 bg-muted/40 border-y border-border/50 flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{weight}</span>
                        <span className="text-xs text-muted-foreground">({weightGroups[weight].length} SKUs)</span>
                        <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1"><GripVertical className="h-3 w-3" />Drag to reorder</span>
                      </div>
                      <table className="w-full text-sm">
                        <thead className="sr-only"><tr><th>#</th><th>Drag</th><th>Name</th><th>Weight</th><th>Category</th><th>Active</th><th>Actions</th></tr></thead>
                        <SortableContext items={weightGroups[weight].map((s: any) => s.id)} strategy={verticalListSortingStrategy}>
                          <tbody>
                            {weightGroups[weight].map((sku: any, i: number) => (
                              <SortableSkuRow
                                key={sku.id}
                                sku={sku}
                                index={i}
                                onDelete={(id) => setDeleteTarget({ id, name: sku.name })}
                                deleteConfirm={deleteTarget?.id ?? null}
                                onCategoryToggle={(id, cat) => updateCategoryMutation.mutate({ id, category: cat === "Core" ? "NPI" : "Core"})}
                                onToggleActive={(s) => toggleActiveMutation.mutate({
                                  skuId: s.id,
                                  isActive: s.isActive === false ? true : false,
                                  skuName: s.name,
                                  country: "Lebanon",
                                })}
                                isAdmin={isAdmin}
                              />
                            ))}
                          </tbody>
                        </SortableContext>
                      </table>
                    </div>
                  ))
                )}
              </div>
            </DndContext>
          </CardContent>
        </Card>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={open => { if (!open) { setCreateOpen(false); resetCreateForm(); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create New SKU</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">SKU Name *</label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Al Fakher Two Apple" autoFocus />
            </div>

            {/* All Sizes toggle */}
            <div
              onClick={() => setAllSizes(v => !v)}
              className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                allSizes ? "bg-primary/5 border-primary" : "border-border bg-background hover:bg-muted/50"
              }`}
            >
              <div>
                <p className={`text-sm font-medium ${allSizes ? "text-primary" : "text-foreground"}`}>Create all sizes</p>
                <p className="text-xs text-muted-foreground mt-0.5">Creates 50g, 250g, and 1kg variants in one step</p>
              </div>
              <div className={`w-10 h-5 rounded-full transition-colors relative ${allSizes ? "bg-primary" : "bg-muted"}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${allSizes ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
            </div>

            {allSizes ? (
              <div className="flex gap-2">
                {["50g", "250g", "1kg"].map(w => (
                  <div key={w} className="flex-1 py-2 text-center text-sm rounded-md border bg-primary/5 border-primary text-primary font-medium">{w}</div>
                ))}
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Weight *</label>
                <Select value={newWeight} onValueChange={setNewWeight}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="50g">50g</SelectItem>
                    <SelectItem value="250g">250g</SelectItem>
                    <SelectItem value="1kg">1kg</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Category *</label>
              <Select value={newCategory} onValueChange={v => setNewCategory(v as "Core" | "NPI")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Core">Core</SelectItem>
                  <SelectItem value="NPI">NPI</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2.5">
              {allSizes
                ? `3 SKUs (50g, 250g, 1kg) will be created and will automatically appear in all planning tables for Lebanon.`
                : `This SKU will automatically appear in all Forecast, Production, and Planning FG tables for Lebanon.`
              }
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetCreateForm(); }}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : allSizes ? "Create 3 SKUs" : "Create SKU"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete SKU</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
            This will remove all associated Forecast, Production, and Planning FG data. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id})} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete SKU"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Syria / Libya SKU Management (full CRUD) ───────────────────────────────
type Sku = {
  id: number;
  name: string;
  weight: string;
  category: string;
  packagingType: string | null;
  sortOrder: number;
  isActive: boolean;
};

// Sortable row for Syria/Libya (includes packaging column)
function SortableIntlSkuRow({
  sku,
  index,
  onEdit,
  onDelete,
  onToggleActive,
  deleteTarget,
  isAdmin,
}: {
  sku: Sku;
  index: number;
  onEdit: (sku: Sku) => void;
  onDelete: (sku: Sku) => void;
  onToggleActive: (sku: Sku) => void;
  deleteTarget: { id: number; name: string } | null;
  isAdmin: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sku.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-t border-border/50 hover:bg-muted/30 transition-colors group ${isDragging ? "bg-muted shadow-lg" : ""}`}
    >
      <td className="px-4 py-2.5 text-muted-foreground text-xs">{index + 1}</td>
      <td className="px-2 py-2.5 w-8">
        {isAdmin && (
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing p-1 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors touch-none"
            title="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
      </td>
      <td className="px-4 py-2.5 font-medium">{sku.name}</td>
      <td className="px-4 py-2.5 text-muted-foreground">{sku.weight}</td>
      <td className="px-4 py-2.5">
        <Badge variant={sku.category === "Core" ? "default" : "secondary"} className="text-xs">{sku.category}</Badge>
      </td>
      <td className="px-4 py-2.5">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
          (sku.packagingType ?? "New") === "New"
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : "bg-amber-50 text-amber-700 border-amber-200"
        }`}>
          {sku.packagingType ?? "New"}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <button
          onClick={() => onToggleActive(sku)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
            sku.isActive !== false ? "bg-emerald-500" : "bg-gray-300"
          }`}
          title={sku.isActive !== false ? "Click to disable SKU" : "Click to enable SKU"}
          disabled={!isAdmin}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            sku.isActive !== false ? "translate-x-4" : "translate-x-0.5"
          }`} />
        </button>
      </td>
      <td className="px-4 py-2.5 text-right">
        {isAdmin && (
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onEdit(sku)}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Edit SKU"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onDelete(sku)}
              className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="Delete SKU"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function IntlSkuManagement() {
  const { country } = useCountry();
  const { user: appUser } = useAppAuth();
  const utils = trpc.useUtils();
  const intlCountry = country as "Syria" | "Libya" | "KSA";
  const isAdmin = (appUser as any)?.role === "admin";

  const { data: skusData, isLoading } = trpc.country.skus.useQuery(
    { country: intlCountry, includeInactive: true },
    { enabled: !!country && country !== "Lebanon" }
  );
  const [localSkus, setLocalSkus] = useState<Sku[] | null>(null);
  const displaySkus: Sku[] = localSkus ?? (skusData as Sku[] | undefined) ?? [];

  // Sync localSkus when server data changes
  useMemo(() => {
    if (skusData && !localSkus) setLocalSkus(skusData as Sku[]);
  }, [skusData]);

  const createMutation = trpc.country.createSku.useMutation({
    onSuccess: () => {
      utils.country.skus.invalidate();
      setLocalSkus(null);
      toast.success("SKU created and added to all planning tables.");
      setCreateOpen(false);
      resetCreateForm();
    },
    onError: (err) => toast.error(`Create failed: ${err.message}`),
  });

  const updateMutation = trpc.country.updateSku.useMutation({
    onSuccess: () => {
      utils.country.skus.invalidate();
      setLocalSkus(null);
      toast.success("SKU updated.");
      setEditTarget(null);
    },
    onError: (err) => toast.error(`Update failed: ${err.message}`),
  });

  const deleteMutation = trpc.country.deleteSku.useMutation({
    onSuccess: () => {
      utils.country.skus.invalidate();
      setLocalSkus(null);
      toast.success("SKU and all associated planning data deleted.");
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(`Delete failed: ${err.message}`),
  });

  const toggleActiveMutation = trpc.country.toggleSkuActive.useMutation({
    onMutate: async ({ skuId, isActive }) => {
      await utils.country.skus.cancel();
      const prev = utils.country.skus.getData({ country: intlCountry, includeInactive: true });
      utils.country.skus.setData({ country: intlCountry, includeInactive: true }, (old: any) =>
        old?.map((s: any) => s.id === skuId ? { ...s, isActive } : s)
      );
      setLocalSkus(prev => prev ? prev.map(s => s.id === skuId ? { ...s, isActive } : s) : null);
      return { prev };
    },
    onError: (_err: any, _vars: any, ctx: any) => {
      if (ctx?.prev) utils.country.skus.setData({ country: intlCountry, includeInactive: true }, ctx.prev);
      setLocalSkus(null);
      toast.error("Failed to update SKU status");
    },
    onSettled: () => { utils.country.skus.invalidate(); },
  });

  const reorderMutation = trpc.country.reorderSkus.useMutation({
    onError: () => {
      setLocalSkus(null);
      utils.country.skus.invalidate();
      toast.error("Failed to save order. Refreshing...");
    },
    onSuccess: () => {
      utils.country.skus.invalidate();
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const [search, setSearch] = useState("");
  const [filterPackaging, setFilterPackaging] = useState<"All" | "Old" | "New">("All");
  const [filterCategory, setFilterCategory] = useState<"All" | "Core" | "NPI">("All");
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Sku | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const [newName, setNewName] = useState("");
  const [newWeight, setNewWeight] = useState("250g");
  const [newCategory, setNewCategory] = useState<"Core" | "NPI">("Core");
  const [newPackaging, setNewPackaging] = useState<"Old" | "New">("New");
  const [allSizes, setAllSizes] = useState(false);

  const [editName, setEditName] = useState("");
  const [editWeight, setEditWeight] = useState("");
  const [editCategory, setEditCategory] = useState<"Core" | "NPI">("Core");
  const [editPackaging, setEditPackaging] = useState<"Old" | "New">("New");

  function resetCreateForm() {
    setNewName(""); setNewWeight("250g"); setNewCategory("Core"); setNewPackaging("New"); setAllSizes(false);
  }

  function openEdit(sku: Sku) {
    setEditTarget(sku);
    setEditName(sku.name);
    setEditWeight(sku.weight);
    setEditCategory((sku.category as "Core" | "NPI") || "Core");
    setEditPackaging((sku.packagingType as "Old" | "New") || "New");
  }

  async function handleCreateSku() {
    if (!newName.trim()) { toast.error("Please enter a SKU name"); return; }
    if (allSizes) {
      const sizes = ["50g", "250g", "1kg"];
      let created = 0;
      for (const w of sizes) {
        await createMutation.mutateAsync({
          country: intlCountry,
          name: newName.trim(),
          weight: w,
          category: newCategory,
          packagingType: newPackaging,
        });
        created++;
      }
      utils.country.skus.invalidate();
      setLocalSkus(null);
      toast.success(`Created ${created} SKUs (50g, 250g, 1kg) for "${newName.trim()}".`);
      setCreateOpen(false);
      resetCreateForm();
    } else {
      createMutation.mutate({
        country: intlCountry,
        name: newName.trim(),
        weight: newWeight,
        category: newCategory,
        packagingType: newPackaging,
      });
    }
  }

  const filtered = useMemo(() => {
    return displaySkus.filter((s: Sku) => {
      const q = search.toLowerCase();
      const matchSearch = !q || s.name.toLowerCase().includes(q) || s.weight.toLowerCase().includes(q);
      const matchPkg = filterPackaging === "All" || (s.packagingType ?? "New") === filterPackaging;
      const matchCat = filterCategory === "All" || s.category === filterCategory;
      return matchSearch && matchPkg && matchCat;
    });
  }, [displaySkus, search, filterPackaging, filterCategory]);

  const stats = useMemo(() => {
    if (!displaySkus.length) return { total: 0, old: 0, newPkg: 0, core: 0, npi: 0 };
    return {
      total: displaySkus.length,
      old: displaySkus.filter((s: Sku) => s.packagingType === "Old").length,
      newPkg: displaySkus.filter((s: Sku) => (s.packagingType ?? "New") === "New").length,
      core: displaySkus.filter((s: Sku) => s.category === "Core").length,
      npi: displaySkus.filter((s: Sku) => s.category === "NPI").length,
    };
  }, [displaySkus]);

  // Group filtered SKUs by weight for DnD sections
  const weightGroups = useMemo(() => {
    const groups: Record<string, Sku[]> = {};
    for (const sku of filtered) {
      if (!groups[sku.weight]) groups[sku.weight] = [];
      groups[sku.weight].push(sku);
    }
    return groups;
  }, [filtered]);

  const weightOrder = ["50g", "250g", "1kg", ...Object.keys(weightGroups).filter(w => !["50g", "250g", "1kg"].includes(w))];

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const allSkusList = localSkus ?? (skusData as Sku[] | undefined) ?? [];
    const oldIndex = allSkusList.findIndex((s: Sku) => s.id === active.id);
    const newIndex = allSkusList.findIndex((s: Sku) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    if (allSkusList[oldIndex].weight !== allSkusList[newIndex].weight) {
      toast.error("SKUs can only be reordered within the same weight group.");
      return;
    }

    const newOrder = arrayMove(allSkusList, oldIndex, newIndex);
    setLocalSkus(newOrder);
    reorderMutation.mutate({
      country: intlCountry,
      orderedIds: newOrder.map((s: Sku) => s.id),
    });
  }

  const hasSkus = displaySkus.length > 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">SKU Management</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {country} — Create and manage SKUs. Drag rows to reorder within weight groups.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => { exportSkusToExcel(displaySkus, intlCountry); toast.success("Downloading SKU list..."); }} disabled={!displaySkus.length}>
            <Download className="h-4 w-4" />Export
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            New SKU
          </Button>
        </div>
      </div>

      {/* Stats */}
      {hasSkus && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Total SKUs", value: stats.total, color: "text-foreground" },
            { label: "New Packaging", value: stats.newPkg, color: "text-emerald-600" },
            { label: "Old Packaging", value: stats.old, color: "text-amber-600" },
            { label: "Core", value: stats.core, color: "text-blue-600" },
            { label: "NPI", value: stats.npi, color: "text-purple-600" },
          ].map(s => (
            <Card key={s.label} className="p-3">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{s.label}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !hasSkus && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Package className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="font-semibold text-lg mb-2">No SKUs yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              Click <strong>New SKU</strong> to create your first SKU. New SKUs automatically populate all planning tables.
            </p>
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              New SKU
            </Button>
          </CardContent>
        </Card>
      )}

      {/* SKU Table grouped by weight with DnD */}
      {hasSkus && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search SKUs..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              <Select value={filterPackaging} onValueChange={v => setFilterPackaging(v as "All" | "Old" | "New")}>
                <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Packaging</SelectItem>
                  <SelectItem value="New">New</SelectItem>
                  <SelectItem value="Old">Old</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterCategory} onValueChange={v => setFilterCategory(v as "All" | "Core" | "NPI")}>
                <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Categories</SelectItem>
                  <SelectItem value="Core">Core</SelectItem>
                  <SelectItem value="NPI">NPI</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground ml-auto">{filtered.length} of {stats.total}</span>
              {reorderMutation.isPending && <span className="text-xs text-muted-foreground">Saving order...</span>}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <div className="overflow-auto max-h-[60vh]">
                {isLoading ? (
                  <div className="px-4 py-8 text-center text-muted-foreground">Loading SKUs...</div>
                ) : (
                  weightOrder.filter(w => weightGroups[w]?.length > 0).map(weight => (
                    <div key={weight}>
                      <div className="px-4 py-2 bg-muted/40 border-y border-border/50 flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{weight}</span>
                        <span className="text-xs text-muted-foreground">({weightGroups[weight].length} SKUs)</span>
                        <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1"><GripVertical className="h-3 w-3" />Drag to reorder</span>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-muted-foreground border-b border-border/50">
                            <th className="px-4 py-2 text-left font-medium">#</th>
                            <th className="px-2 py-2 w-8"></th>
                            <th className="px-4 py-2 text-left font-medium">Name</th>
                            <th className="px-4 py-2 text-left font-medium">Weight</th>
                            <th className="px-4 py-2 text-left font-medium">Category</th>
                            <th className="px-4 py-2 text-left font-medium">Packaging</th>
                            <th className="px-4 py-2 text-left font-medium">Active</th>
                            <th className="px-4 py-2 text-right font-medium">Actions</th>
                          </tr>
                        </thead>
                        <SortableContext items={weightGroups[weight].map((s: Sku) => s.id)} strategy={verticalListSortingStrategy}>
                          <tbody>
                            {weightGroups[weight].map((sku: Sku, i: number) => (
                              <SortableIntlSkuRow
                                key={sku.id}
                                sku={sku}
                                index={i}
                                onEdit={openEdit}
                                onDelete={(s) => setDeleteTarget({ id: s.id, name: s.name })}
                                onToggleActive={(s) => toggleActiveMutation.mutate({
                                  skuId: s.id,
                                  isActive: s.isActive === false ? true : false,
                                  skuName: s.name,
                                  country: intlCountry,
                                })}
                                deleteTarget={deleteTarget}
                                isAdmin={isAdmin}
                              />
                            ))}
                          </tbody>
                        </SortableContext>
                      </table>
                    </div>
                  ))
                )}
              </div>
            </DndContext>
          </CardContent>
        </Card>
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Create New SKU</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">SKU Name *</label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Al Fakher Double Apple" autoFocus />
            </div>

            {/* All Sizes toggle */}
            <div
              onClick={() => setAllSizes(v => !v)}
              className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                allSizes ? "bg-primary/5 border-primary" : "border-border bg-background hover:bg-muted/50"
              }`}
            >
              <div>
                <p className={`text-sm font-medium ${allSizes ? "text-primary" : "text-foreground"}`}>Create all sizes</p>
                <p className="text-xs text-muted-foreground mt-0.5">Creates 50g, 250g, and 1kg variants in one step</p>
              </div>
              <div className={`w-10 h-5 rounded-full transition-colors relative ${allSizes ? "bg-primary" : "bg-muted"}`}>
                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${allSizes ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
            </div>

            {allSizes ? (
              <div className="flex gap-2">
                {["50g", "250g", "1kg"].map(w => (
                  <div key={w} className="flex-1 py-2 text-center text-sm rounded-md border bg-primary/5 border-primary text-primary font-medium">{w}</div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Weight *</label>
                  <Select value={newWeight} onValueChange={setNewWeight}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["250g", "1kg", "50g", "100g", "200g", "500g"].map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Category *</label>
                  <Select value={newCategory} onValueChange={v => setNewCategory(v as "Core" | "NPI")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Core">Core</SelectItem>
                      <SelectItem value="NPI">NPI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {allSizes && (
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Category *</label>
                <Select value={newCategory} onValueChange={v => setNewCategory(v as "Core" | "NPI")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Core">Core</SelectItem>
                    <SelectItem value="NPI">NPI</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1.5">Packaging Type</label>
              <div className="flex gap-2">
                {(["New", "Old"] as const).map(p => (
                  <button key={p} type="button" onClick={() => setNewPackaging(p)}
                    className={`flex-1 py-2 text-sm rounded-md border transition-colors ${newPackaging === p ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background hover:bg-muted"}`}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2.5">
              {allSizes
                ? `3 SKUs (50g, 250g, 1kg) will be created and will automatically appear in all planning tables for ${country}.`
                : `This SKU will automatically appear in all Forecast Production, Production, Arrival, and IMS planning tables for ${country}.`
              }
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetCreateForm(); }}>Cancel</Button>
            <Button onClick={handleCreateSku} disabled={!newName.trim() || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : allSizes ? "Create 3 SKUs" : "Create SKU"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={open => { if (!open) setEditTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit SKU</DialogTitle></DialogHeader>
          {editTarget && (
            <div className="space-y-4 py-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">SKU Name *</label>
                <Input value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Weight</label>
                  <Select value={editWeight} onValueChange={setEditWeight}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["250g", "1kg", "50g", "100g", "200g", "500g"].map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">Category</label>
                  <Select value={editCategory} onValueChange={v => setEditCategory(v as "Core" | "NPI")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Core">Core</SelectItem>
                      <SelectItem value="NPI">NPI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1.5">Packaging Type</label>
                <div className="flex gap-2">
                  {(["New", "Old"] as const).map(p => (
                    <button key={p} type="button" onClick={() => setEditPackaging(p)}
                      className={`flex-1 py-2 text-sm rounded-md border transition-colors ${editPackaging === p ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background hover:bg-muted"}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={() => editTarget && updateMutation.mutate({ skuId: editTarget.id, name: editName.trim(), weight: editWeight, category: editCategory, packagingType: editPackaging, skuName: editTarget.name, country: intlCountry })} disabled={!editName.trim() || updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete SKU</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
            This will also remove all associated Forecast Production, Production, Arrival, and IMS data. This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteTarget && deleteMutation.mutate({ skuId: deleteTarget.id, skuName: deleteTarget.name, country: intlCountry })} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete SKU"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────
export default function SkuManagementPage() {
  const { country } = useCountry();
  if (country === "Lebanon") return <LebanonSkuManagement />;
  return <IntlSkuManagement />;
}
