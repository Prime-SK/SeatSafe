import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'workshopDate', pure: true })
export class WorkshopDatePipe implements PipeTransform {
  private readonly formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  transform(instant: string): string {
    return this.formatter.format(new Date(instant));
  }
}
