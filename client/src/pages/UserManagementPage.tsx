import { Fragment, useState, useEffect } from "react";
import { useAppAuth } from "@/contexts/AuthContext";
import type { Country } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Eye, EyeOff, Pencil, Trash2, Plus, ShieldCheck, User, ChevronDown, ChevronRight, History } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const ACTION_LABELS: Record<string, string> = {
  create_user: "created",
  update_user: "updated",
  delete_user: "deleted",
};

const ALL_COUNTRIES: Country[] = ["Lebanon", "Syria", "Libya"];

const COUNTRY_FLAGS: Record<Country, string> = {
  Lebanon: "🇱🇧",
  Syria: "🇸🇾",
  Libya: "🇱🇾",
};

const COUNTRY_COLORS: Record<Country, string> = {
  Lebanon: "bg-red-100 text-red-700 border-red-200",
  Syria: "bg-green-100 text-green-700 border-green-200",
  Libya: "bg-blue-100 text-blue-700 border-blue-200",
};

interface UserFormState {
  username: string;
  displayName: string;
  password: string;
  role: "admin" | "viewer";
  countries: Country[];
  email: string;
}

function emptyForm(): UserFormState {
  return { username: "", displayName: "", password: "", role: "viewer", countries: [], email: "" };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmailFormatValid(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed === "") return true;
  return EMAIL_REGEX.test(trimmed);
}

export default function UserManagementPage() {
  const { isOwner, isAdmin, user: currentUser } = useAppAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isOwner) setLocation("/");
  }, [isOwner, setLocation]);

  const utils = trpc.useUtils();

  const { data: users = [], isLoading } = trpc.appUsers.list.useQuery(
    undefined,
    { enabled: !!currentUser?.username && isOwner }
  );

  const createMutation = trpc.appUsers.create.useMutation({
    onSuccess: () => { utils.appUsers.list.invalidate(); toast.success("User created"); setShowForm(false); setForm(emptyForm()); },
    onError: (e) => setFormError(e.message),
  });
  const updateMutation = trpc.appUsers.update.useMutation({
    onSuccess: () => { utils.appUsers.list.invalidate(); toast.success("User updated"); setShowForm(false); setEditingId(null); },
    onError: (e) => setFormError(e.message),
  });
  const deleteMutation = trpc.appUsers.delete.useMutation({
    onSuccess: () => { utils.appUsers.list.invalidate(); toast.success("User deleted"); setConfirmDelete(null); },
    onError: (e) => toast.error(e.message),
  });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<UserFormState>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState<Set<number>>(new Set());

  function toggleHistory(id: number) {
    setExpandedHistory(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const emailValid = isEmailFormatValid(form.email);

  if (!isOwner) return null;

  type ServerUser = typeof users[0];

  function openCreate() {
    setForm(emptyForm());
    setEditingId(null);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(u: ServerUser) {
    setForm({
      username: u.username,
      displayName: u.displayName,
      password: "",
      role: u.role as "admin" | "viewer",
      countries: (u.countries as string[]).filter((c): c is Country => ALL_COUNTRIES.includes(c as Country)),
      email: u.email ?? "",
    });
    setEditingId(u.id);
    setFormError(null);
    setShowForm(true);
  }

  function toggleCountry(c: Country) {
    setForm(f => ({
      ...f,
      countries: f.countries.includes(c) ? f.countries.filter(x => x !== c) : [...f.countries, c],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.username.trim()) return setFormError("Username is required");
    if (!form.displayName.trim()) return setFormError("Display name is required");
    if (!editingId && !form.password.trim()) return setFormError("Password is required for new users");
    if (form.countries.length === 0) return setFormError("Assign at least one country");
    if (!isEmailFormatValid(form.email)) return setFormError("Contact email is not a valid email address");

    const trimmedEmail = form.email.trim();
    const emailValue = trimmedEmail === "" ? "" : trimmedEmail;

    if (editingId) {
      await updateMutation.mutateAsync({
        id: editingId,
        displayName: form.displayName,
        ...(form.password ? { password: form.password } : {}),
        role: form.role,
        countries: form.countries,
        email: emailValue,
      });
    } else {
      await createMutation.mutateAsync({
        username: form.username,
        displayName: form.displayName,
        password: form.password,
        role: form.role,
        countries: form.countries,
        ...(emailValue ? { email: emailValue } : {}),
      });
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground mt-1">
            {isOwner
              ? "Create and manage user accounts. Assign each user to one or more countries."
              : "View all user accounts and their access levels."}
          </p>
        </div>
        {isOwner && !showForm && (
          <Button onClick={openCreate} className="shrink-0 gap-2">
            <Plus className="h-4 w-4" /> Add User
          </Button>
        )}
      </div>

      {/* Create / Edit Form */}
      {showForm && isOwner && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">
              {editingId ? "Edit User" : "Create New User"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">Username <span className="text-destructive">*</span></label>
                  <Input
                    value={form.username}
                    onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    placeholder="e.g. elias"
                    disabled={!!editingId}
                    className={editingId ? "opacity-60" : ""}
                  />
                  {editingId && <p className="text-xs text-muted-foreground">Username cannot be changed.</p>}
                </div>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">Display Name <span className="text-destructive">*</span></label>
                  <Input
                    value={form.displayName}
                    onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                    placeholder="e.g. Elias Khoury"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">
                    Password {editingId && <span className="text-muted-foreground font-normal">(leave blank to keep)</span>}
                    {!editingId && <span className="text-destructive"> *</span>}
                  </label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      placeholder={editingId ? "New password (optional)" : "Set password"}
                      className="pr-9"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium">Role</label>
                  <div className="flex gap-2 pt-1">
                    {(["admin", "viewer"] as const).map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, role: r }))}
                        className={`flex-1 py-1.5 rounded-md border text-sm font-medium transition-colors ${
                          form.role === r
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border hover:bg-muted"
                        }`}
                      >
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid gap-1.5">
                <label className="text-sm font-medium">
                  Contact Email <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="e.g. owner@company.com"
                  aria-invalid={!emailValid}
                  className={!emailValid ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {!emailValid ? (
                  <p className="text-xs text-destructive font-medium">
                    Please enter a valid email address (e.g. name@company.com), or leave blank.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Shown on the no-access screen so stranded users can reach a workspace owner. Leave blank to omit.
                  </p>
                )}
              </div>

              <div className="grid gap-1.5">
                <label className="text-sm font-medium">Country Access <span className="text-destructive">*</span></label>
                <div className="flex gap-2 flex-wrap">
                  {ALL_COUNTRIES.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleCountry(c)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${
                        form.countries.includes(c)
                          ? COUNTRY_COLORS[c]
                          : "bg-background border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <span>{COUNTRY_FLAGS[c]}</span> {c}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Select which countries this user can log in to.</p>
              </div>

              {formError && (
                <p className="text-sm text-destructive font-medium">{formError}</p>
              )}

              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending || !emailValid}>
                  {editingId ? "Save Changes" : "Create User"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm()); setFormError(null); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* User Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">User Accounts ({users.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading users...</div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No users found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left py-3 px-4 font-medium">User</th>
                    <th className="text-left py-3 px-4 font-medium">Username</th>
                    <th className="text-left py-3 px-4 font-medium">Email</th>
                    <th className="text-left py-3 px-4 font-medium">Role</th>
                    <th className="text-left py-3 px-4 font-medium">Country Access</th>
                    {isOwner && <th className="text-right py-3 px-4 font-medium">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const isCurrentUser = currentUser?.username === u.username;
                    const lastChange = u.lastChange;
                    const isExpanded = expandedHistory.has(u.id);
                    const lastChangeAgo = lastChange
                      ? formatDistanceToNow(new Date(lastChange.createdAt), { addSuffix: true })
                      : null;
                    const lastChangeTitle = lastChange
                      ? `${ACTION_LABELS[lastChange.action] ?? lastChange.action} by ${lastChange.username} on ${new Date(lastChange.createdAt).toLocaleString()}`
                      : "";
                    const colSpan = isOwner ? 6 : 5;
                    return (
                      <Fragment key={u.id}>
                      <tr className={`border-b last:border-b-0 hover:bg-muted/30 transition-colors ${isExpanded ? "bg-muted/20" : ""}`}>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${
                              u.isOwner ? "bg-gradient-to-br from-amber-400 to-orange-500" : "bg-gradient-to-br from-emerald-400 to-teal-500"
                            }`}>
                              {u.isOwner ? <ShieldCheck className="h-4 w-4" /> : <User className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium flex items-center gap-1.5">
                                {u.displayName}
                                {u.isOwner && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">Owner</span>
                                )}
                                {isCurrentUser && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 border border-blue-200">You</span>
                                )}
                              </div>
                              {lastChange ? (
                                <button
                                  type="button"
                                  onClick={() => toggleHistory(u.id)}
                                  title={lastChangeTitle}
                                  className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                  data-testid={`button-toggle-history-${u.id}`}
                                >
                                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                  <History className="h-3 w-3" />
                                  <span>
                                    {ACTION_LABELS[lastChange.action] ?? lastChange.action} by{" "}
                                    <span className="font-medium">{lastChange.username}</span>
                                    {" · "}
                                    {lastChangeAgo}
                                  </span>
                                </button>
                              ) : (
                                <div className="mt-0.5 text-[11px] text-muted-foreground italic">No recorded changes</div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{u.username}</td>
                        <td className="py-3 px-4 text-muted-foreground text-xs">
                          {u.email ? (
                            <a
                              href={`mailto:${u.email}`}
                              className="hover:text-foreground hover:underline"
                            >
                              {u.email}
                            </a>
                          ) : (
                            <span className="italic">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                            {u.role}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {u.isOwner ? (
                              <Badge variant="outline" className="text-xs">All Countries</Badge>
                            ) : (
                              (u.countries as string[]).map(c => (
                                <Badge key={c} variant="outline" className={`text-xs gap-1 ${COUNTRY_COLORS[c as Country] ?? ""}`}>
                                  <span>{COUNTRY_FLAGS[c as Country] ?? "🌐"}</span>{c}
                                </Badge>
                              ))
                            )}
                          </div>
                        </td>
                        {isOwner && (
                          <td className="py-3 px-4 text-right">
                            {!u.isOwner && (
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openEdit(u)}
                                  className="h-7 w-7 p-0"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                {confirmDelete === u.id ? (
                                  <div className="flex items-center gap-1">
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      className="h-7 text-xs px-2"
                                      onClick={() => deleteMutation.mutate({ id: u.id })}
                                      disabled={deleteMutation.isPending}
                                    >
                                      Confirm
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs px-2"
                                      onClick={() => setConfirmDelete(null)}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setConfirmDelete(u.id)}
                                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                      {isExpanded && lastChange && (
                        <tr className="border-b last:border-b-0 bg-muted/10" data-testid={`row-history-${u.id}`}>
                          <td colSpan={colSpan} className="py-2 px-4">
                            <div className="ml-11 text-xs text-muted-foreground space-y-0.5">
                              <div>
                                <span className="font-medium text-foreground capitalize">
                                  {ACTION_LABELS[lastChange.action] ?? lastChange.action}
                                </span>{" "}
                                by <span className="font-medium text-foreground">{lastChange.username}</span>
                                {" · "}
                                <span title={new Date(lastChange.createdAt).toLocaleString()}>
                                  {lastChangeAgo}
                                </span>
                              </div>
                              {lastChange.details && (
                                <div className="whitespace-pre-wrap break-words">{lastChange.details}</div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
