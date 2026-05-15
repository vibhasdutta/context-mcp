import {
  saveDiscussion, getDiscussion, listDiscussions, deleteDiscussion,
  updateDiscussion, updateDiscussionStep, clearDiscussionLink,
} from '../db.js';

export const definition = {
  name: 'discussion',
  description:
    `Forward-looking thinking space — plans, research, ideas, design.\n` +
    `• "save"        — Create or update a discussion.\n` +
    `• "update"      — Patch specific fields without touching the rest.\n` +
    `• "get"         — Retrieve by name or id (full content + steps).\n` +
    `• "list"        — List discussions (filterable). Header + stepsSummary only.\n` +
    `• "delete"      — Remove by name or id.\n` +
    `• "update_step" — Mark a step done/in-progress. Auto-closes when all done.`,
  inputSchema: {
    type: 'object',
    properties: {
      action:           { type: 'string', enum: ['save', 'get', 'list', 'delete', 'update', 'update_step'] },
      name:             { type: 'string' },
      id:               { type: 'string' },
      project:          { type: 'string' },
      title:            { type: 'string' },
      description:      { type: 'string' },
      content:          { type: 'string' },
      type:             { type: 'string', enum: ['plan', 'research', 'idea', 'design', 'implementation', 'review', 'thread'] },
      status:           { type: 'string', enum: ['active', 'done'] },
      tags:             { type: 'array', items: { type: 'string' } },
      parentId:         { type: 'string' },
      linkedContextIds: { type: 'array', items: { type: 'string' } },
      steps:            { type: 'array', items: { type: 'object' } },
      stepId:           { type: 'string' },
      stepStatus:       { type: 'string', enum: ['pending', 'in-progress', 'done', 'skipped'] },
      linkedContextId:  { type: 'string' },
      filterStatus:     { type: 'string' },
      filterType:       { type: 'string' },
    },
    required: ['action'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      success:     { type: 'boolean' },
      id:          { type: 'string' },
      name:        { type: 'string' },
      discussion:  { type: 'object' },
      discussions: { type: 'array' },
      step:        { type: 'object' },
      message:     { type: 'string' },
    },
  },
};

export async function handle(args, state) {
  switch (args.action) {
    case 'save': {
      if (!args.name) throw new Error('name is required for save');
      const disc = saveDiscussion({ ...args, sessionId: args.sessionId || state.sessionId });
      if (disc.status === 'active')                                  state.discussionId = disc.id;
      else if (state.discussionId === disc.id)                       state.discussionId = null;
      return { success: true, id: disc.id, name: disc.name,
        message: `Discussion "${disc.name}" saved (${disc.type}, ${disc.status}).` };
    }

    case 'get': {
      if (!args.name && !args.id) throw new Error('name or id is required for get');
      const disc = getDiscussion({ name: args.name, id: args.id, project: args.project });
      return disc
        ? { discussion: disc }
        : { discussion: null, message: `No discussion found for "${args.name || args.id}".` };
    }

    case 'update': {
      if (!args.name && !args.id) throw new Error('name or id is required for update');
      const updated = updateDiscussion({ ...args });
      if (!updated) throw new Error(`No discussion found for "${args.name || args.id}".`);
      if (updated.status !== 'active' && state.discussionId === updated.id) state.discussionId = null;
      if (updated.status === 'active')                                        state.discussionId = updated.id;
      return { success: true, id: updated.id, name: updated.name, status: updated.status,
        message: `Discussion "${updated.name}" updated (${updated.status}).` };
    }

    case 'list': {
      return { discussions: listDiscussions({ project: args.project, status: args.filterStatus, type: args.filterType }) };
    }

    case 'delete': {
      if (!args.name && !args.id) throw new Error('name or id is required for delete');
      const toDelete = getDiscussion({ name: args.name, id: args.id });
      if (toDelete) {
        for (const ctxId of (toDelete.linkedContextIds || [])) clearDiscussionLink(ctxId);
      }
      const del = deleteDiscussion({ name: args.name, id: args.id });
      if (state.discussionId) {
        const matchById   = args.id   && args.id   === state.discussionId;
        const matchByName = args.name && del.deleted > 0;
        if (matchById || matchByName) state.discussionId = null;
      }
      return { ...del, message: `Deleted ${del.deleted} discussion(s).` };
    }

    case 'update_step': {
      if (!args.name && !args.id) throw new Error('name or id is required for update_step');
      if (!args.stepId) throw new Error('stepId is required for update_step');
      const updated = updateDiscussionStep({
        discussionName:  args.name,
        discussionId:    args.id,
        stepId:          args.stepId,
        status:          args.stepStatus,
        linkedContextId: args.linkedContextId,
      });
      if (!updated) throw new Error('Discussion or step not found.');
      if (updated.discussion.status === 'done' && state.discussionId === updated.discussion.id) {
        state.discussionId = null;
      }
      return { success: true, step: updated.step, discussionStatus: updated.discussion.status,
        message: `Step updated. Discussion "${updated.discussion.name}" is now "${updated.discussion.status}".` };
    }

    default:
      throw new Error(`Unknown discussion action: ${args.action}`);
  }
}
