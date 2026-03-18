import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { MessageSquare, Send, Trash2, User, Clock, ChevronDown, ChevronUp } from "lucide-react";

export default function VersionComments({ versionId }: { versionId: number }) {
  const { user, isAdmin } = useAppAuth();
  const username = user?.displayName || user?.username || "Unknown";
  const [expanded, setExpanded] = useState(false);
  const [newComment, setNewComment] = useState("");

  const commentsQuery = trpc.versions.comments.useQuery(
    { versionId },
    { enabled: expanded }
  );
  const addCommentMutation = trpc.versions.addComment.useMutation();
  const deleteCommentMutation = trpc.versions.deleteComment.useMutation();

  const comments = commentsQuery.data || [];

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      await addCommentMutation.mutateAsync({
        versionId,
        username,
        comment: newComment.trim(),
      });
      setNewComment("");
      commentsQuery.refetch();
      toast.success("Comment added");
    } catch (err: any) {
      toast.error("Failed to add comment", {
        description: err.message || "Unknown error",
      });
    }
  };

  const handleDeleteComment = async (id: number) => {
    try {
      await deleteCommentMutation.mutateAsync({ id, username });
      commentsQuery.refetch();
      toast.success("Comment deleted");
    } catch (err: any) {
      toast.error("Failed to delete comment");
    }
  };

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <MessageSquare className="h-3 w-3" />
        <span>
          Notes & Comments
          {comments.length > 0 && !expanded && (
            <span className="ml-1 text-[10px] bg-slate-200 text-slate-600 px-1 rounded">
              {comments.length}
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 pl-1 border-l-2 border-slate-200 ml-1">
          {/* Existing comments */}
          {commentsQuery.isLoading ? (
            <div className="text-xs text-muted-foreground py-2 pl-3">
              Loading comments...
            </div>
          ) : comments.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2 pl-3">
              No comments yet. Add a note to document decisions or context.
            </div>
          ) : (
            comments.map((comment) => (
              <div
                key={comment.id}
                className="pl-3 py-1.5 group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <User className="h-3 w-3" />
                        {comment.username}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {new Date(comment.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs mt-0.5 whitespace-pre-wrap">
                      {comment.comment}
                    </p>
                  </div>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => handleDeleteComment(comment.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Add comment form */}
          <div className="pl-3 pt-1 flex gap-2">
            <Textarea
              placeholder="Add a note or comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              rows={2}
              className="text-xs min-h-[48px] resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  handleAddComment();
                }
              }}
            />
            <Button
              size="sm"
              className="h-auto px-2 bg-slate-700 hover:bg-slate-800"
              onClick={handleAddComment}
              disabled={!newComment.trim() || addCommentMutation.isPending}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="pl-3 text-[10px] text-muted-foreground">
            Press Ctrl+Enter to submit
          </div>
        </div>
      )}
    </div>
  );
}
