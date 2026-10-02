import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { VideollamadaFlotanteComponent } from './components/videollamada-flotante/videollamada-flotante';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, VideollamadaFlotanteComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly title = signal('frontend');
}
