import * as z from "zod";
import * as msgpack from "@msgpack/msgpack";
import log from "log";
import { TypedEventTarget } from "./utils";

const logger = log.get("messages");

const ConnectionLoginMsgBodySchema = z.object({
	username: z.string(),
	api_key: z.string().optional(),
});

export type ConnectionLoginMsgBody = z.infer<typeof ConnectionLoginMsgBodySchema>;

const ConnectionClientErrorMsgBodySchema = z.object({
	message: z.string(),
});
export type ConnectionClientErrorMsgBody = z.infer<typeof ConnectionClientErrorMsgBodySchema>;

const ConnectionClosedReasonSchema = z.enum([
	"unauthorized",
	"server_error",
	"room_closed",
	"timeout",
	"unknown",
]);
export type ConnectionClosedReason = z.infer<typeof ConnectionClosedReasonSchema>;

const ConnectionClosedMsgBodySchema = z.object({
	reason: ConnectionClosedReasonSchema,
	message: z.string(),
});
export type ConnectionClosedMsgBody = z.infer<typeof ConnectionClosedMsgBodySchema>;

const RoomCreateMsgBodySchema = z.object({
	name: z.string(),
	password: z.string(),
});
export type RoomCreateMsgBody = z.infer<typeof RoomCreateMsgBodySchema>;

const RoomJoinMsgBodySchema = z.object({
	id: z.string().uuid(),
	password: z.string(),
});
export type RoomJoinMsgBody = z.infer<typeof RoomJoinMsgBodySchema>;

const RoomUserRoleSchema = z.enum(["host", "guest"]);
export type RoomUserRole = z.infer<typeof RoomUserRoleSchema>;

const RoomUserSchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	role: RoomUserRoleSchema,
});
export type RoomUser = z.infer<typeof RoomUserSchema>;

const RoomStateMsgBodySchema = z.object({
	id: z.string().uuid(),
	name: z.string(),
	password: z.string(),
	users: z.array(RoomUserSchema),
});
export type RoomStateMsgBody = z.infer<typeof RoomStateMsgBodySchema>;

const RoomDisconnectedReason = z.enum(["closed_by_host", "unauthorized", "server_error"]);
export type RoomDisconnected = z.infer<typeof RoomDisconnectedReason>;

const RoomDisconnectedMsgBodySchema = z.object({
	reason: RoomDisconnectedReason,
});
export type RoomDisconnectedMsgBody = z.infer<typeof RoomDisconnectedMsgBodySchema>;

const EmptyMessageBodySchema = z.object({});

const MessageBodySchema = z.discriminatedUnion("m", [
	ConnectionLoginMsgBodySchema.extend({ m: z.literal("connection::login/v1") }),
	EmptyMessageBodySchema.extend({ m: z.literal("connection::login_ack/v1") }),
	EmptyMessageBodySchema.extend({ m: z.literal("connection::ping/v1") }),
	EmptyMessageBodySchema.extend({ m: z.literal("connection::pong/v1") }),
	ConnectionClientErrorMsgBodySchema.extend({ m: z.literal("connection::client_error/v1") }),
	ConnectionClosedMsgBodySchema.extend({ m: z.literal("connection::closed/v1") }),
	EmptyMessageBodySchema.extend({ m: z.literal("connection::keepalive/v1") }),
	RoomCreateMsgBodySchema.extend({ m: z.literal("room::create/v1") }),
	EmptyMessageBodySchema.extend({ m: z.literal("room::create_ack/v1") }),
	EmptyMessageBodySchema.extend({ m: z.literal("room::close/v1") }),
	EmptyMessageBodySchema.extend({ m: z.literal("room::close_ack/v1") }),
	RoomJoinMsgBodySchema.extend({ m: z.literal("room::join/v1") }),
	EmptyMessageBodySchema.extend({ m: z.literal("room::join_ack/v1") }),
	EmptyMessageBodySchema.extend({ m: z.literal("room::leave/v1") }),
	EmptyMessageBodySchema.extend({ m: z.literal("room::leave_ack/v1") }),
	RoomDisconnectedMsgBodySchema.extend({ m: z.literal("room::disconnected/v1") }),
	EmptyMessageBodySchema.extend({ m: z.literal("room::request_state/v1") }),
	RoomStateMsgBodySchema.extend({ m: z.literal("room::state/v1") }),
]);
export type MessageBody = z.infer<typeof MessageBodySchema>;

const MessageMetaSchema = z.object({
	t: z.number(),
});

const MessageSchema = MessageMetaSchema.and(MessageBodySchema);
type Message = z.infer<typeof MessageSchema>;

export class MessageEvent extends Event {
	constructor(public message: Message) {
		super("message");
	}
}

export interface MessageChannelEventMap {
	"close": Event,
	"open": Event,
	"message": MessageEvent
}

export class MessageChannel extends TypedEventTarget<MessageChannelEventMap> {
	private ws: WebSocket;
	private open = true;

	constructor(url: URL | string) {
		super();
		this.ws = new WebSocket(url);
		this.ws.addEventListener("message", (evt) => {
			try {
				if (!(evt.data instanceof Uint8Array)) {
					logger.error(`Expected to receive a Uint8Array, but got %o`, evt.data);
					return;
				}
				const message = this.decodeMessage(evt.data);
				this.dispatchEvent(new MessageEvent(message));
			} catch (e) {
				logger.error(`Failed to decode received message: %s`, e);
			}
		});
		this.ws.addEventListener("error", () => {
			logger.error("Websocket disconnected due to an error.");
			this.onClosed();
		});
		this.ws.addEventListener("close", () => {
			this.onClosed();
		});
	}

	public isOpen(): boolean {
		return this.open;
	}

	public close() {
		this.ws.close();
	}

	private onClosed() {
		this.open = false;
		this.dispatchEvent(new Event("closed"));
	}

	public send(body: MessageBody): void {
		try {
			this.ws.send(this.encodeMessage(body));
		} catch (e) {
			logger.error(`Failed to send message: %s`, e);
		}
	}

	private encodeMessage(body: MessageBody): Uint8Array {
		const message: Message = {
			t: Date.now(),
			...body,
		};
		return msgpack.encode(message);
	}

	private decodeMessage(data: Uint8Array): Message {
		const decoded = msgpack.decode(data);
		const message = MessageSchema.parse(decoded);
		return message;
	}
}
