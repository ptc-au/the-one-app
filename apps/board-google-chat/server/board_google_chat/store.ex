defmodule BoardGoogleChat.Store do
  @moduledoc """
  Board Google Chat Sync's SQLite schema: which Board channel is mirrored in which Google Chat space, and each
  Google Chat thread and message made for a Board thread or message, so a reply lands where it belongs and an edit
  or a deletion finds what it's about.
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
    """
  ]

  def schema, do: @schema

  def transaction(call, fun) do
    database = Call.app(call, "database")
    database.transaction(call, @schema, &fun.({database, &1}))
  end

  def query({database, db}, sql, values \\ []), do: database.query(db, sql, values)

  def now_iso, do: DateTime.utc_now() |> DateTime.to_iso8601()
end
