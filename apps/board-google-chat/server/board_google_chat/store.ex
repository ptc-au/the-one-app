defmodule BoardGoogleChat.Store do
  @moduledoc """
  Board Google Chat Sync's SQLite schema: which Board channel is mirrored in which Google Chat space, each Google Chat
  thread and message made for a Board thread or message, and the outbound queue for messages waiting to be sent or
  retried so nothing is lost when Google Chat is unreachable.
  """

  alias OneCore.Call

  @schema [
    """
    create table mappings (
      space_name text primary key,
      channel text not null unique,
      created_at text not null
    )
    """,
    """
    create table thread_links (
      board_root_id text primary key,
      space_name text not null,
      chat_thread_name text not null unique
    )
    """,
    """
    create table message_links (
      board_message_id text primary key,
      chat_message_name text not null unique,
      board_root_id text not null,
      space_name text not null,
      origin text not null default 'board'
    )
    """,
    """
    create table outbox (
      board_message_id text primary key,
      board_root_id text not null,
      space_name text not null,
      channel text not null,
      text text not null,
      status text not null default 'pending',
      attempts integer not null default 0,
      next_attempt_at integer,
      last_error text,
      created_at text not null,
      updated_at text not null
    )
    """,
    "alter table mappings add column watch_state text not null default 'watching'",
    "alter table mappings add column watch_error text",
    "alter table message_links add column extra_chat_messages text"
  ]

  def schema, do: @schema

  def transaction(call, fun) do
    database = Call.app(call, "database")
    database.transaction(call, @schema, &fun.({database, &1}))
  end

  def query({database, db}, sql, values \\ []), do: database.query(db, sql, values)

  def now_iso, do: DateTime.utc_now() |> DateTime.to_iso8601()
  def now_sec, do: System.system_time(:second)
end
