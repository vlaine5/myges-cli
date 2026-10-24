import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';
import { AppError } from '../../lib/app-error';
import type { AcademicProviderId } from '../events/types';
import type { GoogleAuthService } from './google-auth.service';

export class GoogleCalendarService {
  constructor(
    private readonly googleAuthService: GoogleAuthService,
  ) {}

  private async getCalendarApi() {
    const auth = await this.googleAuthService.getAuthorizedClient();

    return google.calendar({
      version: 'v3',
      auth,
    });
  }

  async getConfiguredCalendarId(provider: AcademicProviderId) {
    const selectedCalendar = await this.googleAuthService.getSelectedCalendar(provider);

    if (!selectedCalendar?.calendarId) {
      throw new AppError('Google calendar ID is not configured.', 409, 'GOOGLE_CALENDAR_NOT_SELECTED');
    }

    return selectedCalendar.calendarId;
  }

  async listCalendars() {
    const calendarApi = await this.getCalendarApi();
    const response = await calendarApi.calendarList.list();

    return (response.data.items ?? []).map((calendar) => ({
      id: calendar.id ?? '',
      summary: calendar.summary ?? calendar.id ?? 'Untitled calendar',
      description: calendar.description ?? null,
      primary: calendar.primary ?? false,
      accessRole: calendar.accessRole ?? null,
      timeZone: calendar.timeZone ?? null,
    }));
  }

  async createCalendar(provider: AcademicProviderId, summary: string, timeZone: string) {
    const calendarApi = await this.getCalendarApi();
    const response = await calendarApi.calendars.insert({
      requestBody: {
        summary,
        timeZone,
      },
    });

    const created = response.data;
    const id = created.id;

    if (!id) {
      throw new AppError('Google calendar creation failed.', 502, 'GOOGLE_CALENDAR_CREATE_FAILED');
    }

    await this.googleAuthService.updateSelectedCalendar(provider, id, created.summary ?? summary);

    return {
      id,
      summary: created.summary ?? summary,
      provider,
    };
  }

  async selectCalendar(provider: AcademicProviderId, calendarId: string) {
    const calendars = await this.listCalendars();
    const selected = calendars.find((calendar) => calendar.id === calendarId);

    if (!selected) {
      throw new AppError('The selected Google calendar was not found.', 404, 'GOOGLE_CALENDAR_NOT_FOUND');
    }

    await this.googleAuthService.updateSelectedCalendar(provider, selected.id, selected.summary);

    return {
      ...selected,
      provider,
    };
  }

  async upsertEvent(calendarId: string, requestBody: calendar_v3.Schema$Event, googleEventId?: string | null) {
    const calendarApi = await this.getCalendarApi();

    if (!googleEventId) {
      const response = await calendarApi.events.insert({
        calendarId,
        requestBody,
      });

      return response.data;
    }

    try {
      const response = await calendarApi.events.patch({
        calendarId,
        eventId: googleEventId,
        requestBody,
      });

      return response.data;
    } catch (error) {
      if ((error as { code?: number }).code === 404) {
        const response = await calendarApi.events.insert({
          calendarId,
          requestBody,
        });

        return response.data;
      }

      throw error;
    }
  }

  /** Ids of the events that currently exist (not cancelled) in a calendar over a date range. */
  async listLiveEventIds(calendarId: string, timeMin: Date, timeMax: Date) {
    const calendarApi = await this.getCalendarApi();
    const ids = new Set<string>();
    let pageToken: string | undefined;

    do {
      const response = await calendarApi.events.list({
        calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        showDeleted: false,
        maxResults: 2500,
        pageToken,
      });

      for (const item of response.data.items ?? []) {
        if (item.id && item.status !== 'cancelled') ids.add(item.id);
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return ids;
  }

  async deleteEvent(calendarId: string, googleEventId: string) {
    const calendarApi = await this.getCalendarApi();

    try {
      await calendarApi.events.delete({
        calendarId,
        eventId: googleEventId,
      });
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 404 || code === 410) {
        return;
      }

      throw error;
    }
  }
}
